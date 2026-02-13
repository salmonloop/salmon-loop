import * as crypto from 'crypto';

import type { ToolCallingAuditSink } from '../llm/audit.js';
import { emitLlmOutput, emitLlmStreamDelta, emitLlmStreamEnd } from '../llm/output-policy.js';
import { redactErrorMessage, redactJsonString, redactValue } from '../llm/redact.js';
import { logger } from '../observability/logger.js';
import type {
  ChatOptions,
  ExecutionStep,
  LlmOutputKind,
  LlmOutputPolicy,
  LLMMessage,
  LoopEvent,
  LLM,
} from '../types.js';
import { Phase, type ExecutionPhase } from '../types.js';

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
  if (!argsText.trim()) {
    return { ok: true, value: {} };
  }
  try {
    return { ok: true, value: JSON.parse(argsText) };
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

    const assistant = await session.llm.chat(messages, {
      ...chatOptions,
      tools: openAITools,
      toolSpecs: allowedSpecs,
      toolChoice: openAITools.length > 0 ? 'auto' : undefined,
    });

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

  for (const item of prepared) {
    if (item.toolName && typeof item.toolName === 'string') {
      session.emit?.({
        type: 'log',
        level: 'debug',
        message: `[tool] start ${item.toolName}`,
        timestamp: new Date(),
      });
    }
    session.emit?.({
      type: 'tool.call.start',
      callId: item.callId,
      toolName: typeof item.toolName === 'string' ? item.toolName : 'unknown',
      phase,
      round,
      timestamp: new Date(),
    });
  }

  const toolResults = new Map<string, ToolResult>();
  const nodes: PlanNode[] = [];

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
        toolName: 'unknown',
        rawArgsType: typeof rawArgs,
        rawArgsPreview: typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
        parsedArgsOk: false,
        parsedArgsError: 'Missing function.name',
        toolResultStatus: 'error',
        toolResultErrorCode: 'MALFORMED_TOOL_CALL',
      });
      toolResults.set(callId, {
        id: callId,
        toolName: 'unknown',
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

    const parsed = safeParseJson(rawArgs);
    if (!parsed.ok) {
      session.toolCallingAudit?.event({
        timestamp: new Date().toISOString(),
        phase,
        round,
        callId,
        toolName,
        rawArgsType: typeof rawArgs,
        rawArgsPreview: typeof rawArgs === 'string' ? redactJsonString(rawArgs) : undefined,
        parsedArgsOk: false,
        parsedArgsError: redactErrorMessage(parsed.error),
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
          message: parsed.error,
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
      parsedArgsPreview: safeStringifyForAudit(parsed.value),
    });

    nodes.push({ id: callId, toolName, args: parsed.value, deps: [] });
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
      timestamp: new Date(),
    });

    if (result.status !== 'ok') {
      session.toolCallingAudit?.event({
        timestamp: new Date().toISOString(),
        phase,
        round,
        callId,
        toolName: typeof toolName === 'string' ? toolName : 'unknown',
        rawArgsType: typeof rawArgs,
        parsedArgsOk: true,
        toolResultStatus: result.status,
        toolResultErrorCode: result.error?.code,
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
    let content = '';
    const toolCalls = new ToolCallAccumulator();
    const streamId = session.llmOutput
      ? `llm-${session.llmOutput.kind}-${phase}-${round}-${crypto.randomUUID()}`
      : '';
    let finishReason: string | undefined;

    const stream = session.llm.chatStream(messages, {
      ...chatOptions,
      tools: openAITools,
      toolSpecs: allowedSpecs,
      toolChoice: openAITools.length > 0 ? 'auto' : undefined,
    });

    for await (const chunk of stream) {
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
        break;
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

    const collectedToolCalls = toolCalls.drain();
    const assistant: LLMMessage = {
      role: 'assistant',
      content,
      tool_calls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
    };

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
