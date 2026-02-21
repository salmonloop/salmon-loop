import * as crypto from 'crypto';
import path from 'path';

import type { ToolCallingAuditSink } from '../llm/audit.js';
import { emitLlmOutput, emitLlmStreamDelta, emitLlmStreamEnd } from '../llm/output-policy.js';
import { redactErrorMessage, redactJsonString, redactValue } from '../llm/redact.js';
import { recordAuditEvent } from '../observability/audit-trail.js';
import { logger } from '../observability/logger.js';
import {
  createResponseFunctionCallArgumentsDeltaEvent,
  createResponseFunctionCallArgumentsDoneEvent,
  createResponseOutputItemAddedFunctionCallEvent,
  createResponseOutputItemDoneFunctionCallEvent,
} from '../streaming/canonical/responses-event-emitter.js';
import type {
  ChatOptions,
  ExecutionStep,
  LlmOutputKind,
  LlmOutputPolicy,
  LLMMessage,
  LoopEvent,
  LLM,
} from '../types/index.js';
import { Phase, type ExecutionPhase } from '../types/index.js';
import { isSafeRelativePath, normalizePath } from '../utils/path.js';

import { buildHeadlessToolInputPayload } from './headless-payload.js';
import { toolToOpenAI } from './mapper.js';
import { InMemoryLockManager } from './parallel/lock-manager.js';
import { PlanPersistence } from './parallel/persistence.js';
import type { ExecutionPlan, PlanNode } from './parallel/plan.js';
import { ParallelScheduler } from './parallel/scheduler.js';
import type { ToolRouter } from './router.js';
import { ToolCallAccumulator } from './streaming/ToolCallAccumulator.js';
import type { ToolCallEnvelope, ToolRuntimeCtx, ToolResult, ToolSpec } from './types.js';

interface ToolstackLike {
  registry: { listAll(): ToolSpec[] };
  policy: {
    decide(
      phase: ExecutionPhase,
      spec: ToolSpec,
      ctx: { worktreeRoot?: string },
    ): { allowed: boolean };
  };
  router: {
    call(envelope: ToolCallEnvelope): Promise<ToolResult>;
    getSpec?: (name: string) => ToolSpec | undefined;
    waitForAuthorization?: (requestId: string, signal?: AbortSignal) => Promise<boolean>;
  };
}

export interface ToolCallingSessionOptions {
  phase: ExecutionPhase;
  llm: LLM;
  runtime: ToolRuntimeCtx;
  toolstack: ToolstackLike;
  toolCallingAudit?: ToolCallingAuditSink;
  emit?: (event: LoopEvent) => void;
  eventPayload?: {
    includeToolInput?: boolean;
    includeToolOutput?: boolean;
  };
  llmOutput?: {
    policy?: LlmOutputPolicy;
    kind: LlmOutputKind;
    step: ExecutionStep;
  };
  maxRounds?: number;
  maxToolCallsTotal?: number;
  maxToolCallsPerRound?: number;
}

function safeParseJson(argsText: unknown): { ok: true; value: any } | { ok: false; error: string } {
  if (typeof argsText !== 'string') {
    return { ok: true, value: argsText };
  }
  const trimmed = argsText.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }
  try {
    let value: unknown = JSON.parse(trimmed);

    // Some models will JSON-encode the arguments object as a string (double-encoded JSON).
    // Example raw args: "\"{\\\"pattern\\\":\\\"README\\\"}\"" -> first parse returns string.
    if (typeof value === 'string') {
      const nested = value.trim();
      const looksJsonObject =
        (nested.startsWith('{') && nested.endsWith('}')) ||
        (nested.startsWith('[') && nested.endsWith(']'));
      if (looksJsonObject) {
        try {
          value = JSON.parse(nested);
        } catch {
          // Ignore: fall back to the first parse result to preserve observability.
        }
      }
    }

    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function formatToolResultForModel(result: ToolResult): string {
  const payload = {
    id: result.id,
    toolName: result.toolName,
    status: result.status,
    output: result.output,
    summary: result.summary,
    error: result.error,
    meta: result.meta,
    durationMs: result.durationMs,
  };
  try {
    return JSON.stringify(payload);
  } catch {
    return JSON.stringify({
      id: result.id,
      toolName: result.toolName,
      status: 'error',
      error: {
        code: 'SERIALIZE_ERROR',
        message: 'Failed to serialize tool result',
        retryable: false,
      },
    });
  }
}

function safeStringifyForAudit(value: unknown): string {
  try {
    return redactJsonString(JSON.stringify(redactValue(value)));
  } catch {
    return '[Unserializable]';
  }
}

function defaultMaxToolCallsTotalForPhase(phase: ExecutionPhase): number {
  if (phase === Phase.EXPLORE) return 18;
  if (phase === Phase.PLAN) return 10;
  if (phase === Phase.PATCH) return 10;
  return 10;
}

function defaultMaxToolCallsPerRoundForPhase(phase: ExecutionPhase): number {
  if (phase === Phase.EXPLORE) return 6;
  if (phase === Phase.PLAN) return 4;
  if (phase === Phase.PATCH) return 4;
  return 4;
}

function getToolCallBudget(session: ToolCallingSessionOptions): {
  maxTotal: number;
  maxPerRound: number;
} {
  const maxTotal = session.maxToolCallsTotal ?? defaultMaxToolCallsTotalForPhase(session.phase);
  const maxPerRound =
    session.maxToolCallsPerRound ?? defaultMaxToolCallsPerRoundForPhase(session.phase);
  return {
    maxTotal: Math.max(0, Math.floor(maxTotal)),
    maxPerRound: Math.max(0, Math.floor(maxPerRound)),
  };
}

type ToolCallBudgetState = {
  used: number;
  maxTotal: number;
  maxPerRound: number;
};

/**
 * Runs an OpenAI-style tool calling loop:
 * - Send messages (+ tools)
 * - If assistant returns tool_calls, execute them via ToolRouter
 * - Feed tool results back as role='tool' messages
 * - Repeat until no tool_calls or maxRounds reached
 */
export async function chatWithTools(
  initialMessages: LLMMessage[],
  chatOptions: ChatOptions,
  session: ToolCallingSessionOptions,
): Promise<LLMMessage> {
  const maxRounds = session.maxRounds ?? 6;
  const phase = session.phase;
  const budget = getToolCallBudget(session);
  (
    session as ToolCallingSessionOptions & { __toolCallBudgetState?: ToolCallBudgetState }
  ).__toolCallBudgetState = { used: 0, ...budget };

  const allowedSpecs = session.toolstack.registry.listAll().filter((spec) => {
    return session.toolstack.policy.decide(phase, spec, {
      worktreeRoot: session.runtime.worktreeRoot,
    }).allowed;
  });

  const openAITools = allowedSpecs.map(toolToOpenAI);

  if (openAITools.length > 0) {
    session.emit?.({
      type: 'log',
      level: 'debug',
      message: `Tool calling enabled (${openAITools.length} tools available)`,
      timestamp: new Date(),
    });
  }

  const messages: LLMMessage[] = [...initialMessages];

  for (let round = 0; round < maxRounds; round++) {
    // Check for abort before starting a new round
    if (chatOptions.signal?.aborted) {
      throw new Error('Operation aborted');
    }

    const roundStartedAt = Date.now();
    let assistant: LLMMessage;
    try {
      assistant = await session.llm.chat(messages, {
        ...chatOptions,
        tools: openAITools,
        toolSpecs: allowedSpecs,
        toolChoice: openAITools.length > 0 ? 'auto' : undefined,
      });
    } catch (e) {
      recordAuditEvent(
        'llm.round',
        {
          status: 'error',
          streamed: false,
          phase,
          round,
          model: session.runtime.model,
          durationMs: Date.now() - roundStartedAt,
        },
        { source: 'llm', severity: 'low', scope: 'session', phase },
      );
      throw e;
    }

    recordAuditEvent(
      'llm.round',
      {
        status: 'ok',
        streamed: false,
        phase,
        round,
        model: session.runtime.model,
        durationMs: Date.now() - roundStartedAt,
        contentChars: typeof assistant.content === 'string' ? assistant.content.length : 0,
        toolCallCount: Array.isArray(assistant.tool_calls) ? assistant.tool_calls.length : 0,
      },
      { source: 'llm', severity: 'low', scope: 'session', phase },
    );

    messages.push({
      role: 'assistant',
      content: assistant.content || '',
      tool_calls: assistant.tool_calls,
    });

    const toolCalls = assistant.tool_calls || [];
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
      if (session.llmOutput) {
        emitLlmOutput({
          emit: session.emit,
          policy: session.llmOutput.policy,
          kind: session.llmOutput.kind,
          step: session.llmOutput.step,
          content: assistant.content || '',
        });
      }
      return assistant;
    }

    // Check for abort before executing tools
    if (chatOptions.signal?.aborted) {
      throw new Error('Operation aborted');
    }

    await executeToolCalls(session, phase, round, toolCalls, messages, chatOptions.signal);
  }

  // If we reach here, the model is stuck in tool calling. Return the last assistant content.
  session.emit?.({
    type: 'log',
    level: 'warn',
    message: `Tool calling exceeded maximum rounds (${maxRounds}); continuing without further tool execution`,
    timestamp: new Date(),
  });

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  if (session.llmOutput && lastAssistant?.content) {
    emitLlmOutput({
      emit: session.emit,
      policy: session.llmOutput.policy,
      kind: session.llmOutput.kind,
      step: session.llmOutput.step,
      content: lastAssistant.content,
    });
  }
  return lastAssistant || { role: 'assistant', content: '' };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapRetryError(err: unknown): unknown {
  if (!err || typeof err !== 'object') return err;
  const candidate = err as Record<string, unknown>;
  if (candidate.lastError) return candidate.lastError;
  return err;
}

function extractStatusCode(err: unknown): number | undefined {
  const unwrapped = unwrapRetryError(err);
  if (!unwrapped || typeof unwrapped !== 'object') return undefined;

  const meta = (unwrapped as any)?.meta;
  if (meta && typeof meta === 'object' && typeof (meta as any).statusCode === 'number') {
    return (meta as any).statusCode;
  }

  const statusCode = (unwrapped as any)?.statusCode;
  if (typeof statusCode === 'number') return statusCode;

  const response = (unwrapped as any)?.response;
  if (response && typeof response === 'object' && typeof (response as any).status === 'number') {
    return (response as any).status;
  }

  return undefined;
}

function extractNetworkCode(err: unknown): string | undefined {
  const unwrapped = unwrapRetryError(err);
  if (!unwrapped || typeof unwrapped !== 'object') return undefined;
  const code = (unwrapped as any)?.code;
  if (typeof code === 'string') return code;

  const cause = (unwrapped as any)?.cause;
  if (cause && typeof cause === 'object' && typeof (cause as any).code === 'string') {
    return (cause as any).code;
  }

  const meta = (unwrapped as any)?.meta;
  if (meta && typeof meta === 'object' && typeof (meta as any).causeName === 'string') {
    return (meta as any).causeName;
  }

  return undefined;
}

function extractProvider(err: unknown): string | undefined {
  const unwrapped = unwrapRetryError(err);
  if (!unwrapped || typeof unwrapped !== 'object') return undefined;

  const meta = (unwrapped as any)?.meta;
  if (meta && typeof meta === 'object' && typeof (meta as any).provider === 'string') {
    return (meta as any).provider;
  }

  const provider = (unwrapped as any)?.provider;
  if (typeof provider === 'string') return provider;

  return undefined;
}

const ENABLE_TOOL_ARG_REPAIR =
  process.env.SALMONLOOP_ENABLE_TOOL_ARG_REPAIR === '1' ||
  process.env.SALMONLOOP_ENABLE_TOOL_ARG_REPAIR === 'true';

const SAFE_INFERRED_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.json',
  '.md',
  '.txt',
  '.css',
  '.html',
  '.vue',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.h',
]);

function inferHighConfidenceFiles(instruction: string): string[] {
  const candidates: string[] = [];
  const normalized = instruction || '';

  if (/README\b/i.test(normalized)) {
    candidates.push('README.md');
  }

  const pathLike = /(?:^|\s)([a-zA-Z0-9][a-zA-Z0-9._/-]*\.[a-zA-Z0-9]{1,8})(?:\s|$)/g;
  let match: RegExpExecArray | null = null;
  while ((match = pathLike.exec(normalized)) !== null) {
    const raw = match[1];
    if (!raw) continue;

    const rel = normalizePath(raw).replace(/^(\.\/|\/)+/, '');
    if (!rel) continue;
    if (!isSafeRelativePath(rel)) continue;

    const lower = rel.toLowerCase();
    if (lower.startsWith('.')) continue;
    if (lower.includes('/.')) continue;
    if (lower.startsWith('.git/') || lower.startsWith('.salmonloop/')) continue;
    if (lower.includes('node_modules/')) continue;

    const ext = path.extname(rel).toLowerCase();
    if (!SAFE_INFERRED_EXTENSIONS.has(ext)) continue;

    candidates.push(rel);
    if (candidates.length >= 3) break;
  }

  return Array.from(new Set(candidates));
}

function extractInstructionText(messages: LLMMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
  if (!text) return '';

  const match = text.match(/(^|\n)# Instruction\s*\n([\s\S]*?)(\n# |$)/);
  if (!match) return text;
  return match[2]?.trim() || '';
}

async function executeToolCalls(
  session: ToolCallingSessionOptions,
  phase: ExecutionPhase,
  round: number,
  calls: any[],
  messages: LLMMessage[],
  signal?: AbortSignal,
): Promise<void> {
  const prepared = calls.map((call) => {
    const callId = call?.id || crypto.randomUUID();
    const toolName = call?.function?.name;
    const rawArgs = call?.function?.arguments;
    return { callId, toolName, rawArgs };
  });

  const budget = getToolCallBudget(session);
  // Keep budget state on the session object to share between rounds without expanding public API.
  const anySession = session as ToolCallingSessionOptions & {
    __toolCallBudgetState?: ToolCallBudgetState;
  };
  const budgetState: ToolCallBudgetState = anySession.__toolCallBudgetState || {
    used: 0,
    ...budget,
  };
  // Ensure runtime updates (if caller overrides budget between invocations) are respected.
  budgetState.maxTotal = budget.maxTotal;
  budgetState.maxPerRound = budget.maxPerRound;
  anySession.__toolCallBudgetState = budgetState;

  const toolResults = new Map<string, ToolResult>();
  const nodes: PlanNode[] = [];
  const toolArgsPreviewByCallId = new Map<string, string>();
  const rawArgsPreviewByCallId = new Map<string, string | undefined>();
  const rawArgsTypeByCallId = new Map<string, string>();

  const roundCap = Math.min(
    budgetState.maxPerRound,
    Math.max(0, budgetState.maxTotal - budgetState.used),
  );
  budgetState.used += prepared.length;

  if (prepared.length > roundCap) {
    session.emit?.({
      type: 'log',
      level: 'warn',
      message: `Tool call budget exceeded; denying ${prepared.length - roundCap} tool calls (phase=${phase}, round=${round})`,
      timestamp: new Date(),
    });
  }

  let allowedUsed = 0;
  for (const item of prepared) {
    const { callId, toolName, rawArgs } = item;
    const normalizedToolName = typeof toolName === 'string' ? toolName : 'unknown';

    let parsedArgsOk = true;
    let argsValue: unknown = undefined;
    let parsedArgsError: string | undefined;
    const parsed = safeParseJson(rawArgs);
    if (parsed.ok) {
      argsValue = parsed.value;
      rawArgsPreviewByCallId.set(
        callId,
        typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
      );
      rawArgsTypeByCallId.set(callId, typeof rawArgs);
    } else {
      parsedArgsOk = false;
      parsedArgsError = parsed.error;
      rawArgsPreviewByCallId.set(
        callId,
        typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
      );
      rawArgsTypeByCallId.set(callId, typeof rawArgs);
    }

    // Repair common missing-args tool calls for weak tool-call models:
    // - fs.read called with `{}` is almost always a missing `file` parameter.
    // We only apply a conservative inference based on the explicit instruction block.
    if (
      parsedArgsOk &&
      ENABLE_TOOL_ARG_REPAIR &&
      phase === Phase.EXPLORE &&
      normalizedToolName === 'fs.read' &&
      isObjectRecord(argsValue) &&
      typeof (argsValue as any).file !== 'string'
    ) {
      const instruction = extractInstructionText(messages);
      const inferred = inferHighConfidenceFiles(instruction);
      if (inferred.length > 0) {
        argsValue = { ...(argsValue as any), file: inferred[0] };
      }
    }

    if (parsedArgsOk) {
      toolArgsPreviewByCallId.set(callId, safeStringifyForAudit(argsValue));
    }

    const input =
      session.eventPayload?.includeToolInput && parsedArgsOk
        ? buildHeadlessToolInputPayload(argsValue)
        : undefined;

    if (typeof toolName === 'string') {
      session.emit?.({
        type: 'log',
        level: 'debug',
        message: `[tool] start ${toolName}`,
        timestamp: new Date(),
      });
    }

    session.emit?.({
      type: 'tool.call.start',
      callId,
      toolName: normalizedToolName,
      phase,
      round,
      input,
      timestamp: new Date(),
    });

    // Hard budget: deny tool execution once the session exceeds the configured budget.
    // We still return a tool result for protocol completeness and observability.
    if (allowedUsed >= roundCap) {
      toolResults.set(callId, {
        id: callId,
        toolName: typeof toolName === 'string' ? toolName : 'unknown',
        source: 'builtin',
        status: 'error',
        error: {
          code: 'TOOL_CALL_BUDGET_EXCEEDED',
          message:
            'Tool call denied: tool calling budget exceeded for this session. Continue without additional tool calls.',
          retryable: false,
          failurePhase: phase,
        },
        durationMs: 0,
      });
      continue;
    }

    allowedUsed++;

    if (!toolName || typeof toolName !== 'string') {
      logger.warn('Received malformed tool call (missing function.name)');
      session.toolCallingAudit?.event({
        timestamp: new Date().toISOString(),
        phase,
        round,
        callId,
        toolName: normalizedToolName,
        rawArgsType: typeof rawArgs,
        rawArgsPreview: typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
        parsedArgsOk: false,
        parsedArgsError: 'Missing function.name',
        toolResultStatus: 'error',
        toolResultErrorCode: 'MALFORMED_TOOL_CALL',
      });
      toolResults.set(callId, {
        id: callId,
        toolName: normalizedToolName,
        source: 'builtin',
        status: 'error',
        error: {
          code: 'MALFORMED_TOOL_CALL',
          message: 'Missing function.name',
          retryable: true,
          failurePhase: phase,
        },
      });
      continue;
    }

    session.emit?.({
      type: 'log',
      level: 'debug',
      message: `Tool call requested: ${toolName}`,
      timestamp: new Date(),
    });

    if (!parsedArgsOk) {
      const error = parsedArgsError ?? 'Invalid tool arguments';
      session.toolCallingAudit?.event({
        timestamp: new Date().toISOString(),
        phase,
        round,
        callId,
        toolName,
        rawArgsType: typeof rawArgs,
        rawArgsPreview: typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
        parsedArgsOk: false,
        parsedArgsError: redactErrorMessage(error),
        toolResultStatus: 'error',
        toolResultErrorCode: 'INVALID_TOOL_ARGUMENTS_JSON',
      });
      toolResults.set(callId, {
        id: callId,
        toolName,
        source: 'builtin',
        status: 'error',
        error: {
          code: 'INVALID_TOOL_ARGUMENTS_JSON',
          message: error,
          retryable: true,
          failurePhase: phase,
        },
      });
      continue;
    }

    const spec = session.toolstack.registry.listAll().find((s) => s.name === toolName);
    session.toolCallingAudit?.event({
      timestamp: new Date().toISOString(),
      phase,
      round,
      callId,
      toolName,
      toolIntent: spec?.intent,
      rawArgsType: typeof rawArgs,
      rawArgsPreview: typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
      parsedArgsOk: true,
      parsedArgsPreview: safeStringifyForAudit(argsValue),
    });

    nodes.push({ id: callId, toolName, args: argsValue, deps: [] });
  }

  if (nodes.length > 0) {
    const plan: ExecutionPlan = {
      id: `tool-round-${round}-${crypto.randomUUID()}`,
      nodes,
      policy: {
        maxParallelism: Math.min(nodes.length, 8),
        readParallelism: Math.min(nodes.length, 8),
        writeParallelism: 1,
        failFast: false,
        deterministic: true,
      },
    };

    const scheduler = new ParallelScheduler(
      session.toolstack.router as ToolRouter,
      new InMemoryLockManager(),
    );

    const runSignal = signal ?? new AbortController().signal;
    let result = await scheduler.run(plan, { ...session.runtime, phase }, runSignal);

    const persistEnabled = process.env.NODE_ENV !== 'test';
    const persistenceRoot = session.runtime.persistenceRoot || session.runtime.repoRoot;
    if (persistEnabled) {
      await PlanPersistence.save(persistenceRoot, plan, result, {
        repoRoot: session.runtime.repoRoot,
        worktreeRoot: session.runtime.worktreeRoot,
        persistenceRoot: session.runtime.persistenceRoot,
        phase,
        model: session.runtime.model,
      });
    }

    const waitForAuthorization = session.toolstack.router.waitForAuthorization;
    const canWaitForAuth = typeof waitForAuthorization === 'function';

    let resumeAttempts = 0;
    while (result.blockedApprovals.length > 0 && canWaitForAuth && !runSignal.aborted) {
      resumeAttempts++;
      if (resumeAttempts > 10) break;

      // Wait for all pending approvals in this plan run, then resume only blocked nodes.
      await Promise.all(
        result.blockedApprovals.map(async (a) => {
          await waitForAuthorization?.(a.nodeId, runSignal);
        }),
      );

      result = await scheduler.run(plan, { ...session.runtime, phase }, runSignal, {
        initialResults: result.nodeResults,
        resumeBlockedApprovals: true,
      });

      if (persistEnabled) {
        await PlanPersistence.save(persistenceRoot, plan, result, {
          repoRoot: session.runtime.repoRoot,
          worktreeRoot: session.runtime.worktreeRoot,
          persistenceRoot: session.runtime.persistenceRoot,
          phase,
          model: session.runtime.model,
        });
      }
    }

    for (const node of nodes) {
      const r = result.nodeResults[node.id];
      const toolResult = r?.toolResult as ToolResult | undefined;
      if (toolResult) {
        toolResults.set(node.id, toolResult);
        continue;
      }

      toolResults.set(node.id, {
        id: node.id,
        toolName: node.toolName,
        source: 'builtin',
        status: 'error',
        error: {
          code: 'PPD_TOOL_RESULT_MISSING',
          message: 'Parallel scheduler did not return tool result',
          retryable: true,
          failurePhase: phase,
        },
      });
    }
  }

  for (const item of prepared) {
    const { callId, toolName, rawArgs } = item;
    const result = toolResults.get(callId);
    if (!result) continue;

    // Strict output schema validation
    if (result.status === 'ok' && typeof toolName === 'string') {
      const spec =
        session.toolstack.router.getSpec?.(toolName) ||
        session.toolstack.registry.listAll().find((s) => s.name === toolName);

      if (spec?.outputSchema) {
        const parsed = spec.outputSchema.safeParse(result.output);
        if (parsed.success) {
          result.output = parsed.data;
        } else {
          const validationError = parsed.error.message;
          logger.error(
            `[tool] schema violation for ${toolName} (callId: ${callId}): ${validationError}`,
          );

          result.status = 'error';
          result.error = {
            code: 'SCHEMA_VIOLATION',
            message: `Tool output does not match expected schema: ${validationError}`,
            retryable: false,
            failurePhase: phase,
          };
        }
      }
    }

    session.emit?.({
      type: 'log',
      level: result.status === 'ok' ? 'info' : 'warn',
      message: `[tool] done ${toolName || 'unknown'} status=${result.status}`,
      timestamp: new Date(),
    });
    session.emit?.({
      type: 'tool.call.end',
      callId,
      toolName: typeof toolName === 'string' ? toolName : 'unknown',
      phase,
      round,
      status: result.status,
      durationMs: result.durationMs,
      errorCode: result.error?.code,
      outputSummary:
        session.eventPayload?.includeToolOutput &&
        (typeof result.outputSummary === 'string' || typeof result.summary === 'string')
          ? ((result.outputSummary ?? result.summary) as string)
          : undefined,
      timestamp: new Date(),
    });

    if (result.status !== 'ok') {
      const errorCode = result.error?.code;
      const attachArgsPreview = errorCode === 'INVALID_INPUT';
      session.toolCallingAudit?.event({
        timestamp: new Date().toISOString(),
        phase,
        round,
        callId,
        toolName: typeof toolName === 'string' ? toolName : 'unknown',
        rawArgsType: rawArgsTypeByCallId.get(callId) ?? typeof rawArgs,
        parsedArgsOk: true,
        toolResultStatus: result.status,
        toolResultErrorCode: errorCode,
        toolResultErrorMessage:
          attachArgsPreview && result.error?.message
            ? redactErrorMessage(result.error.message)
            : undefined,
        rawArgsPreview: attachArgsPreview ? rawArgsPreviewByCallId.get(callId) : undefined,
        parsedArgsPreview: attachArgsPreview ? toolArgsPreviewByCallId.get(callId) : undefined,
      });
    }

    messages.push({
      role: 'tool',
      name: typeof toolName === 'string' ? toolName : 'unknown',
      tool_call_id: callId,
      content: formatToolResultForModel(result),
    });
  }
}

/**
 * Streaming variant of {@link chatWithTools}. It consumes {@link LLM.chatStream} to assemble the
 * assistant message (content + tool_calls), then executes tool calls the same way as the
 * non-streaming loop.
 *
 * Notes:
 * - Tool execution is still round-based: tools are executed only after the assistant turn completes.
 * - Text deltas are only emitted when an LLM output policy enables them.
 */
export async function chatWithToolsStreaming(
  initialMessages: LLMMessage[],
  chatOptions: ChatOptions,
  session: ToolCallingSessionOptions,
): Promise<LLMMessage> {
  if (!session.llm.chatStream) {
    return chatWithTools(initialMessages, chatOptions, session);
  }

  const maxRounds = session.maxRounds ?? 6;
  const phase = session.phase;
  const budget = getToolCallBudget(session);
  (
    session as ToolCallingSessionOptions & { __toolCallBudgetState?: ToolCallBudgetState }
  ).__toolCallBudgetState = { used: 0, ...budget };

  const allowedSpecs = session.toolstack.registry.listAll().filter((spec) => {
    return session.toolstack.policy.decide(phase, spec, {
      worktreeRoot: session.runtime.worktreeRoot,
    }).allowed;
  });

  const openAITools = allowedSpecs.map(toolToOpenAI);

  if (openAITools.length > 0) {
    session.emit?.({
      type: 'log',
      level: 'debug',
      message: `Tool calling enabled (${openAITools.length} tools available)`,
      timestamp: new Date(),
    });
  }

  const messages: LLMMessage[] = [...initialMessages];

  for (let round = 0; round < maxRounds; round++) {
    const roundStartedAt = Date.now();
    let content = '';
    const toolCalls = new ToolCallAccumulator();
    const emittedModelToolCallIds = new Set<string>();
    const streamId = session.llmOutput
      ? `llm-${session.llmOutput.kind}-${phase}-${round}-${crypto.randomUUID()}`
      : '';
    let finishReason: string | undefined;
    let finishUsage: { promptTokens: number; completionTokens: number } | undefined;
    let usedFallback = false;

    try {
      const stream = session.llm.chatStream(messages, {
        ...chatOptions,
        tools: openAITools,
        toolSpecs: allowedSpecs,
        toolChoice: openAITools.length > 0 ? 'auto' : undefined,
      });

      for await (const chunk of stream) {
        if (session.emit && session.llmOutput && Array.isArray(chunk?.tool_calls)) {
          for (const call of chunk.tool_calls) {
            const callId = call?.id;
            const toolName = call?.function?.name;
            if (typeof callId !== 'string' || !callId) continue;
            if (typeof toolName !== 'string' || !toolName) continue;
            if (emittedModelToolCallIds.has(callId)) continue;
            emittedModelToolCallIds.add(callId);

            const itemId = `function_call:${callId}`;
            const at = new Date();
            session.emit({
              type: 'llm.responses.event',
              kind: session.llmOutput.kind,
              step: session.llmOutput.step,
              streamId,
              phase,
              round,
              source: 'synthesized',
              event: createResponseOutputItemAddedFunctionCallEvent({
                itemId,
                callId,
                name: toolName,
                argumentsText: '{}',
              }),
              timestamp: at,
            });

            session.emit({
              type: 'llm.responses.event',
              kind: session.llmOutput.kind,
              step: session.llmOutput.step,
              streamId,
              phase,
              round,
              source: 'synthesized',
              event: createResponseFunctionCallArgumentsDeltaEvent({
                itemId,
                delta: '{}',
              }),
              timestamp: at,
            });

            session.emit({
              type: 'llm.responses.event',
              kind: session.llmOutput.kind,
              step: session.llmOutput.step,
              streamId,
              phase,
              round,
              source: 'synthesized',
              event: createResponseFunctionCallArgumentsDoneEvent({
                itemId,
                name: toolName,
                argumentsText: '{}',
              }),
              timestamp: at,
            });
          }
        }

        if (typeof chunk?.contentDelta === 'string' && chunk.contentDelta) {
          if (session.llmOutput) {
            emitLlmStreamDelta({
              emit: session.emit,
              policy: session.llmOutput.policy,
              kind: session.llmOutput.kind,
              step: session.llmOutput.step,
              streamId,
              content: chunk.contentDelta,
            });
          }
          content += chunk.contentDelta;
        }
        toolCalls.append(chunk);
        if (chunk?.done) {
          finishReason = chunk.finishReason;
          if (
            chunk.usage &&
            typeof chunk.usage.promptTokens === 'number' &&
            typeof chunk.usage.completionTokens === 'number'
          ) {
            finishUsage = chunk.usage;
          }
          break;
        }
      }
    } catch (e) {
      recordAuditEvent(
        'llm.round',
        {
          status: 'error',
          streamed: true,
          usedFallback: false,
          phase,
          round,
          model: session.runtime.model,
          durationMs: Date.now() - roundStartedAt,
          provider: extractProvider(e),
          statusCode: extractStatusCode(e),
          networkCode: extractNetworkCode(e),
          errorName: e instanceof Error ? e.name : 'UnknownError',
          errorCode:
            typeof (e as any)?.llmCode === 'string'
              ? (e as any).llmCode
              : typeof (e as any)?.code === 'string'
                ? (e as any).code
                : undefined,
        },
        { source: 'llm', severity: 'low', scope: 'session', phase },
      );
      throw e;
    }

    if (finishUsage) {
      recordAuditEvent(
        'llm.usage',
        {
          promptTokens: finishUsage.promptTokens,
          completionTokens: finishUsage.completionTokens,
        },
        { source: 'llm', severity: 'low', scope: 'session', phase },
      );
    }

    let collectedToolCalls = toolCalls.drain();
    let finalContent = content;

    // Some providers/models occasionally end a stream without emitting any deltas. When this happens,
    // fall back to a single non-streaming call so downstream steps don't see an empty response.
    if (finalContent.trim() === '' && collectedToolCalls.length === 0) {
      recordAuditEvent(
        'llm.stream.empty_fallback',
        { phase, round },
        { source: 'llm', severity: 'low', scope: 'session', phase },
      );

      usedFallback = true;
      const fallback = await session.llm.chat(messages, {
        ...chatOptions,
        tools: openAITools,
        toolSpecs: allowedSpecs,
        toolChoice: openAITools.length > 0 ? 'auto' : undefined,
      });

      finalContent = fallback.content || '';
      const fallbackCalls = Array.isArray(fallback.tool_calls) ? fallback.tool_calls : [];
      collectedToolCalls = fallbackCalls;

      if (session.llmOutput && finalContent) {
        emitLlmOutput({
          emit: session.emit,
          policy: session.llmOutput.policy,
          kind: session.llmOutput.kind,
          step: session.llmOutput.step,
          content: finalContent,
        });
      }
    }

    if (session.emit && session.llmOutput && collectedToolCalls.length > 0) {
      const seenDoneIds = new Set<string>();
      for (const call of collectedToolCalls) {
        const callId = call?.id;
        const toolName = call?.function?.name;
        if (typeof callId !== 'string' || !callId) continue;
        if (typeof toolName !== 'string' || !toolName) continue;
        if (seenDoneIds.has(callId)) continue;
        seenDoneIds.add(callId);

        if (!emittedModelToolCallIds.has(callId)) {
          emittedModelToolCallIds.add(callId);
          const itemId = `function_call:${callId}`;
          const at = new Date();
          session.emit({
            type: 'llm.responses.event',
            kind: session.llmOutput.kind,
            step: session.llmOutput.step,
            streamId,
            phase,
            round,
            source: 'synthesized',
            event: createResponseOutputItemAddedFunctionCallEvent({
              itemId,
              callId,
              name: toolName,
              argumentsText: '{}',
            }),
            timestamp: at,
          });

          session.emit({
            type: 'llm.responses.event',
            kind: session.llmOutput.kind,
            step: session.llmOutput.step,
            streamId,
            phase,
            round,
            source: 'synthesized',
            event: createResponseFunctionCallArgumentsDeltaEvent({
              itemId,
              delta: '{}',
            }),
            timestamp: at,
          });

          session.emit({
            type: 'llm.responses.event',
            kind: session.llmOutput.kind,
            step: session.llmOutput.step,
            streamId,
            phase,
            round,
            source: 'synthesized',
            event: createResponseFunctionCallArgumentsDoneEvent({
              itemId,
              name: toolName,
              argumentsText: '{}',
            }),
            timestamp: at,
          });
        }

        const itemId = `function_call:${callId}`;
        const doneAt = new Date();
        session.emit({
          type: 'llm.responses.event',
          kind: session.llmOutput.kind,
          step: session.llmOutput.step,
          streamId,
          phase,
          round,
          source: 'synthesized',
          event: createResponseOutputItemDoneFunctionCallEvent({
            itemId,
            callId,
            name: toolName,
            argumentsText: '{}',
          }),
          timestamp: doneAt,
        });
      }
    }

    if (session.llmOutput) {
      emitLlmStreamEnd({
        emit: session.emit,
        policy: session.llmOutput.policy,
        kind: session.llmOutput.kind,
        step: session.llmOutput.step,
        streamId,
        finishReason,
      });
    }

    const assistant: LLMMessage = {
      role: 'assistant',
      content: finalContent,
      tool_calls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
    };

    recordAuditEvent(
      'llm.round',
      {
        status: 'ok',
        streamed: true,
        usedFallback,
        phase,
        round,
        model: session.runtime.model,
        durationMs: Date.now() - roundStartedAt,
        finishReason,
        contentChars: finalContent.length,
        toolCallCount: collectedToolCalls.length,
      },
      { source: 'llm', severity: 'low', scope: 'session', phase },
    );

    messages.push(assistant);

    const calls = assistant.tool_calls || [];
    if (!Array.isArray(calls) || calls.length === 0) {
      return assistant;
    }

    await executeToolCalls(session, phase, round, calls, messages, chatOptions.signal);
  }

  session.emit?.({
    type: 'log',
    level: 'warn',
    message: `Tool calling exceeded maximum rounds (${maxRounds}); continuing without further tool execution`,
    timestamp: new Date(),
  });

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  return lastAssistant || { role: 'assistant', content: '' };
}
