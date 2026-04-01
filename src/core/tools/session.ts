import * as crypto from 'crypto';
import path from 'path';

import type { ToolCallingAuditSink } from '../llm/audit.js';
import { emitLlmOutput, emitLlmStreamDelta, emitLlmStreamEnd } from '../llm/output-policy.js';
import { redactErrorMessage, redactJsonString, redactValue } from '../llm/redact.js';
import { recordAuditEvent } from '../observability/audit-trail.js';
import { getLogger } from '../observability/logger.js';
import {
  CanonicalResponsesEventEmitter,
  type CanonicalStreamPart,
} from '../streaming/canonical/canonical-responses-event-emitter.js';
import { mapLlmStreamChunkToCanonicalStreamParts } from '../streaming/canonical/parts-from-llm-stream-chunk.js';
import type { CanonicalResponsesEvent } from '../streaming/canonical/responses-events.js';
import { ArtifactStore } from '../sub-agent/artifacts/store.js';
import type { ChatOptions, LlmOutputKind, LlmOutputPolicy, LLM, LLMMessage } from '../types/llm.js';
import type { ExecutionStep, LoopEvent } from '../types/runtime.js';
import { Phase, type ExecutionPhase } from '../types/runtime.js';
import { isSafeRelativePath, normalizePath } from '../utils/path.js';

import { buildHeadlessToolInputPayload } from './headless-payload.js';
import { toolToOpenAI } from './mapper.js';
import { InMemoryLockManager } from './parallel/lock-manager.js';
import { PlanPersistence } from './parallel/persistence.js';
import type { ExecutionPlan, PlanNode } from './parallel/plan.js';
import { ParallelScheduler } from './parallel/scheduler.js';
import type { ToolRouter } from './router.js';
import { ToolCallAccumulator } from './streaming/ToolCallAccumulator.js';
import { resolvePhaseVisibleTools, type ToolVisibilityRuntime } from './tool-visibility.js';
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
  toolVisibility?: ToolVisibilityRuntime;
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

function isArtifactHandleRecord(value: unknown): value is {
  handle: string;
  mimeType: string;
  sha256: string;
  size: number;
} {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as {
    handle?: unknown;
    mimeType?: unknown;
    sha256?: unknown;
    size?: unknown;
  };
  return (
    typeof candidate.handle === 'string' &&
    typeof candidate.mimeType === 'string' &&
    typeof candidate.sha256 === 'string' &&
    typeof candidate.size === 'number'
  );
}

function extractArtifactHandlesFromToolOutput(output: unknown): {
  patchArtifact?: {
    handle: string;
    mimeType: string;
    sha256: string;
    size: number;
  };
  auditArtifact?: {
    handle: string;
    mimeType: string;
    sha256: string;
    size: number;
  };
} {
  if (!isObjectRecord(output)) {
    return {};
  }

  const patchArtifact = isArtifactHandleRecord(output.patchArtifact)
    ? output.patchArtifact
    : undefined;
  const auditArtifact = isArtifactHandleRecord(output.auditArtifact)
    ? output.auditArtifact
    : undefined;

  return {
    patchArtifact,
    auditArtifact,
  };
}

function extractRecentReadResult(params: { toolName: string; rawArgs: unknown; output: unknown }):
  | {
      path: string;
      content: string;
    }
  | undefined {
  if (params.toolName !== 'fs.read' && params.toolName !== 'code.read') {
    return undefined;
  }
  if (!isObjectRecord(params.output) || typeof params.output.content !== 'string') {
    return undefined;
  }

  const args = safeParseJson(params.rawArgs);
  const argsValue = args.ok ? args.value : params.rawArgs;
  if (!isObjectRecord(argsValue)) return undefined;

  const file = argsValue.file ?? argsValue.file_path ?? argsValue.filePath ?? argsValue.path;
  if (typeof file !== 'string' || !file.trim()) return undefined;

  return {
    path: file,
    content: params.output.content,
  };
}

async function persistRecentReadArtifact(params: {
  toolName: string;
  rawArgs: unknown;
  output: unknown;
}): Promise<
  | {
      path: string;
      artifact: {
        handle: string;
        mimeType: string;
        sha256: string;
        size: number;
      };
    }
  | undefined
> {
  const readResult = extractRecentReadResult(params);
  if (!readResult) return undefined;

  const ext = path.extname(readResult.path).replace(/^\./, '') || 'txt';
  const artifact = await ArtifactStore.saveText({
    content: readResult.content,
    mimeType: 'text/plain',
    fileExt: ext,
  });

  return {
    path: readResult.path,
    artifact,
  };
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

function resetToolCallBudgetState(session: ToolCallingSessionOptions): ToolCallBudgetState {
  const budget = getToolCallBudget(session);
  const state: ToolCallBudgetState = { used: 0, ...budget };
  (
    session as ToolCallingSessionOptions & { __toolCallBudgetState?: ToolCallBudgetState }
  ).__toolCallBudgetState = state;
  return state;
}

function getToolCallBudgetState(session: ToolCallingSessionOptions): ToolCallBudgetState {
  const budget = getToolCallBudget(session);
  const anySession = session as ToolCallingSessionOptions & {
    __toolCallBudgetState?: ToolCallBudgetState;
  };
  const existing = anySession.__toolCallBudgetState;
  if (!existing) {
    const created: ToolCallBudgetState = { used: 0, ...budget };
    anySession.__toolCallBudgetState = created;
    return created;
  }
  // Ensure runtime overrides are respected.
  existing.maxTotal = budget.maxTotal;
  existing.maxPerRound = budget.maxPerRound;
  return existing;
}

function initToolCallRoundBudget(params: {
  session: ToolCallingSessionOptions;
  phase: ExecutionPhase;
  round: number;
  preparedCount: number;
}): { roundCap: number; budgetState: ToolCallBudgetState } {
  const budgetState = getToolCallBudgetState(params.session);
  const roundCap = Math.min(
    budgetState.maxPerRound,
    Math.max(0, budgetState.maxTotal - budgetState.used),
  );
  budgetState.used += params.preparedCount;

  if (params.preparedCount > roundCap) {
    params.session.emit?.({
      type: 'log',
      level: 'warn',
      message: `Tool call budget exceeded; denying ${params.preparedCount - roundCap} tool calls (phase=${params.phase}, round=${params.round})`,
      timestamp: new Date(),
    });
  }

  return { roundCap, budgetState };
}

function isFunctionCallStreamPart(
  part: CanonicalStreamPart,
): part is Extract<CanonicalStreamPart, { callId: string }> {
  switch (part.type) {
    case 'function_call.start':
    case 'function_call_arguments.delta':
    case 'function_call_arguments.done':
    case 'function_call.done':
      return typeof (part as { callId?: unknown }).callId === 'string';
    default:
      return false;
  }
}

function groupNewFunctionCallPartsByCallId(params: {
  parts: CanonicalStreamPart[];
  alreadyEmittedCallIds: Set<string>;
}): Map<string, CanonicalStreamPart[]> {
  const out = new Map<string, CanonicalStreamPart[]>();

  for (const part of params.parts) {
    if (!isFunctionCallStreamPart(part)) continue;
    if (!part.callId) continue;
    if (params.alreadyEmittedCallIds.has(part.callId)) continue;

    const bucket = out.get(part.callId);
    if (bucket) bucket.push(part);
    else out.set(part.callId, [part]);
  }

  return out;
}

function emitCanonicalResponsesEvents(params: {
  emit: (event: LoopEvent) => void;
  llmOutput: { kind: LlmOutputKind; step: ExecutionStep };
  streamId: string;
  phase: ExecutionPhase;
  round: number;
  source: 'provider' | 'synthesized';
  events: CanonicalResponsesEvent[];
  timestamp: Date;
}): void {
  for (const event of params.events) {
    params.emit({
      type: 'llm.responses.event',
      kind: params.llmOutput.kind,
      step: params.llmOutput.step,
      streamId: params.streamId,
      phase: params.phase,
      round: params.round,
      source: params.source,
      event,
      timestamp: params.timestamp,
    });
  }
}

type StreamTurnConsumption = {
  content: string;
  finishReason?: string;
  finishUsage?: { promptTokens: number; completionTokens: number };
};

async function consumeAssistantStreamTurn(params: {
  session: ToolCallingSessionOptions;
  messages: LLMMessage[];
  chatOptions: ChatOptions;
  openAITools: any[];
  allowedSpecs: ToolSpec[];
  phase: ExecutionPhase;
  round: number;
  streamId: string;
  canonicalEmitter: CanonicalResponsesEventEmitter | null;
  emittedModelToolCallIds: Set<string>;
  toolCalls: ToolCallAccumulator;
}): Promise<StreamTurnConsumption> {
  const stream = params.session.llm.chatStream!(params.messages, {
    ...params.chatOptions,
    phase: params.phase,
    tools: params.openAITools,
    toolSpecs: params.allowedSpecs,
    toolChoice: params.openAITools.length > 0 ? 'auto' : undefined,
  });

  let content = '';
  let finishReason: string | undefined;
  let finishUsage: { promptTokens: number; completionTokens: number } | undefined;

  for await (const chunk of stream) {
    if (params.canonicalEmitter && params.session.emit && params.session.llmOutput) {
      const parts = mapLlmStreamChunkToCanonicalStreamParts({ streamId: params.streamId, chunk });
      const at = new Date();
      const source = chunk.source ?? 'provider';
      const toolPartsByCallId = groupNewFunctionCallPartsByCallId({
        parts,
        alreadyEmittedCallIds: params.emittedModelToolCallIds,
      });

      for (const [callId, callParts] of toolPartsByCallId) {
        for (const part of callParts) {
          const events = params.canonicalEmitter.push(part);
          emitCanonicalResponsesEvents({
            emit: params.session.emit,
            llmOutput: params.session.llmOutput,
            streamId: params.streamId,
            phase: params.phase,
            round: params.round,
            source,
            events,
            timestamp: at,
          });
        }
        params.emittedModelToolCallIds.add(callId);
      }
    }

    if (typeof chunk?.contentDelta === 'string' && chunk.contentDelta) {
      if (params.session.llmOutput) {
        emitLlmStreamDelta({
          emit: params.session.emit,
          policy: params.session.llmOutput.policy,
          kind: params.session.llmOutput.kind,
          step: params.session.llmOutput.step,
          streamId: params.streamId,
          content: chunk.contentDelta,
        });
      }
      content += chunk.contentDelta;
    }

    params.toolCalls.append(chunk);

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

  return { content, finishReason, finishUsage };
}

async function applyEmptyStreamFallback(params: {
  session: ToolCallingSessionOptions;
  messages: LLMMessage[];
  chatOptions: ChatOptions;
  openAITools: any[];
  allowedSpecs: ToolSpec[];
  phase: ExecutionPhase;
  round: number;
  content: string;
  collectedToolCalls: any[];
}): Promise<{ usedFallback: boolean; content: string; toolCalls: any[] }> {
  if (params.content.trim() !== '' || params.collectedToolCalls.length > 0) {
    return { usedFallback: false, content: params.content, toolCalls: params.collectedToolCalls };
  }

  recordAuditEvent(
    'llm.stream.empty_fallback',
    { phase: params.phase, round: params.round },
    { source: 'llm', severity: 'low', scope: 'session', phase: params.phase },
  );

  const fallback = await params.session.llm.chat(params.messages, {
    ...params.chatOptions,
    phase: params.phase,
    tools: params.openAITools,
    toolSpecs: params.allowedSpecs,
    toolChoice: params.openAITools.length > 0 ? 'auto' : undefined,
  });

  const finalContent = fallback.content || '';
  const finalCalls = Array.isArray(fallback.tool_calls) ? fallback.tool_calls : [];

  if (params.session.llmOutput && finalContent) {
    emitLlmOutput({
      emit: params.session.emit,
      policy: params.session.llmOutput.policy,
      kind: params.session.llmOutput.kind,
      step: params.session.llmOutput.step,
      content: finalContent,
    });
  }

  return { usedFallback: true, content: finalContent, toolCalls: finalCalls };
}

function emitSynthesizedFunctionCallClosures(params: {
  emit: (event: LoopEvent) => void;
  llmOutput: { kind: LlmOutputKind; step: ExecutionStep };
  canonicalEmitter: CanonicalResponsesEventEmitter | null;
  streamId: string;
  phase: ExecutionPhase;
  round: number;
  collectedToolCalls: any[];
  emittedModelToolCallIds: Set<string>;
}): void {
  if (!params.canonicalEmitter) return;
  if (params.collectedToolCalls.length === 0) return;

  const seenDoneIds = new Set<string>();
  for (const call of params.collectedToolCalls) {
    const callId = call?.id;
    const toolName = call?.function?.name;
    const argsText = call?.function?.arguments;
    if (typeof callId !== 'string' || !callId) continue;
    if (typeof toolName !== 'string' || !toolName) continue;
    if (seenDoneIds.has(callId)) continue;
    seenDoneIds.add(callId);

    if (!params.emittedModelToolCallIds.has(callId)) {
      params.emittedModelToolCallIds.add(callId);
      const at = new Date();
      const startEvents = params.canonicalEmitter.push({
        type: 'function_call.start',
        streamId: params.streamId,
        callId,
        name: toolName,
      });
      const argEvents = params.canonicalEmitter.push({
        type: 'function_call_arguments.done',
        streamId: params.streamId,
        callId,
        name: toolName,
        arguments: typeof argsText === 'string' ? argsText : '{}',
      });

      emitCanonicalResponsesEvents({
        emit: params.emit,
        llmOutput: params.llmOutput,
        streamId: params.streamId,
        phase: params.phase,
        round: params.round,
        source: 'synthesized',
        events: [...startEvents, ...argEvents],
        timestamp: at,
      });
    }

    const doneAt = new Date();
    const doneEvents = params.canonicalEmitter.push({
      type: 'function_call.done',
      streamId: params.streamId,
      callId,
      name: toolName,
      arguments: typeof argsText === 'string' ? argsText : '{}',
    });
    emitCanonicalResponsesEvents({
      emit: params.emit,
      llmOutput: params.llmOutput,
      streamId: params.streamId,
      phase: params.phase,
      round: params.round,
      source: 'synthesized',
      events: doneEvents,
      timestamp: doneAt,
    });
  }
}

type ResolvedToolCalling = {
  allowedSpecs: ToolSpec[];
  openAITools: any[];
};

const PLAN_RUNTIME_UNAVAILABLE_MARKER = 'No plan.* tools are available in this session.';
const PLAN_RUNTIME_SESSION_ID_PATTERN = /- sessionId:\s*([^\s]+)/;
const PLAN_RUNTIME_PATH_HINT_PATTERN = /- planPathHint:\s*([^\s]+)/;

function inferToolVisibilityRuntimeFromMessages(
  messages: LLMMessage[],
): ToolVisibilityRuntime | undefined {
  const systemMessage = messages.find((msg) => msg.role === 'system');
  if (!systemMessage || typeof systemMessage.content !== 'string') return undefined;
  const content = systemMessage.content;

  if (content.includes(PLAN_RUNTIME_UNAVAILABLE_MARKER)) {
    return undefined;
  }

  const sessionIdMatch = content.match(PLAN_RUNTIME_SESSION_ID_PATTERN);
  const planPathHintMatch = content.match(PLAN_RUNTIME_PATH_HINT_PATTERN);
  if (!sessionIdMatch || !planPathHintMatch) return undefined;

  return {
    plan: {
      sessionId: sessionIdMatch[1],
      planPathHint: planPathHintMatch[1],
    },
  };
}

function resolveToolVisibilityRuntime(
  session: ToolCallingSessionOptions,
  messages?: LLMMessage[],
): ToolVisibilityRuntime | undefined {
  if (session.toolVisibility) return session.toolVisibility;
  if (!messages || messages.length === 0) return undefined;
  return inferToolVisibilityRuntimeFromMessages(messages);
}

function resolveToolCallingForSession(params: {
  session: ToolCallingSessionOptions;
  phase: ExecutionPhase;
  messages: LLMMessage[];
}): ResolvedToolCalling {
  const allowedSpecs = params.session.toolstack.registry.listAll().filter((spec) => {
    return params.session.toolstack.policy.decide(params.phase, spec, {
      worktreeRoot: params.session.runtime.worktreeRoot,
    }).allowed;
  });

  const visibilityRuntime = resolveToolVisibilityRuntime(params.session, params.messages);
  const visibleSpecs = resolvePhaseVisibleTools({
    phase: params.phase,
    tools: allowedSpecs,
    runtime: visibilityRuntime,
  });

  const openAITools = visibleSpecs.map(toolToOpenAI);

  return { allowedSpecs: visibleSpecs, openAITools };
}

function emitToolCallingEnabledLogIfNeeded(
  session: ToolCallingSessionOptions,
  openAITools: any[],
  allowedSpecs: ToolSpec[],
): void {
  if (openAITools.length === 0) return;

  const toolNames = allowedSpecs.map((spec) => spec.name).sort();
  const maxNames = 24;
  const visible = toolNames.slice(0, maxNames);
  const overflow = toolNames.length - visible.length;
  const suffix = overflow > 0 ? ` (+${overflow} more)` : '';

  session.emit?.({
    type: 'log',
    level: 'debug',
    message: `Tool calling enabled (${openAITools.length} tools available): ${visible.join(', ')}${suffix}`,
    timestamp: new Date(),
  });
}

type CanonicalEmitterRegistry = {
  get(streamId: string): CanonicalResponsesEventEmitter | null;
  release(streamId: string): void;
  clear(): void;
};

function createCanonicalEmitterRegistry(
  session: ToolCallingSessionOptions,
): CanonicalEmitterRegistry {
  if (!session.emit || !session.llmOutput) {
    return {
      get: () => null,
      release: () => {},
      clear: () => {},
    };
  }

  const emitters = new Map<string, CanonicalResponsesEventEmitter>();

  return {
    get(streamId: string): CanonicalResponsesEventEmitter | null {
      if (!streamId) return null;
      const existing = emitters.get(streamId);
      if (existing) return existing;
      const created = new CanonicalResponsesEventEmitter();
      emitters.set(streamId, created);
      return created;
    },
    release(streamId: string): void {
      if (!streamId) return;
      emitters.delete(streamId);
    },
    clear(): void {
      emitters.clear();
    },
  };
}

function createStreamingStreamId(params: {
  session: ToolCallingSessionOptions;
  phase: ExecutionPhase;
  round: number;
}): string {
  if (!params.session.llmOutput) return '';
  return `llm-${params.session.llmOutput.kind}-${params.phase}-${params.round}-${crypto.randomUUID()}`;
}

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
  resetToolCallBudgetState(session);
  const messages: LLMMessage[] = [...initialMessages];
  const { allowedSpecs, openAITools } = resolveToolCallingForSession({
    session,
    phase,
    messages,
  });
  emitToolCallingEnabledLogIfNeeded(session, openAITools, allowedSpecs);

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
        phase,
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObjectRecord(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describeValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function formatPlanUpdatePatchTypeError(actualType: string): string {
  return (
    `Invalid field: patch (received ${actualType}). ` +
    'Expected object with optional keys: status, checkbox, appendSubtasks, note. ' +
    'Do not JSON-stringify patch.'
  );
}

function coercePlanUpdatePatch(args: Record<string, unknown>): {
  args: Record<string, unknown>;
  coercedPatchSource?: string;
  error?: string;
} {
  if (!Object.prototype.hasOwnProperty.call(args, 'patch')) return { args };

  const patch = (args as { patch?: unknown }).patch;
  if (isPlainObject(patch)) return { args };

  if (typeof patch === 'string') {
    const trimmed = patch.trim();
    const looksLikeObjectLiteral = trimmed.startsWith('{') && trimmed.endsWith('}');
    if (!looksLikeObjectLiteral) {
      return { args, error: formatPlanUpdatePatchTypeError('string') };
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) {
        return { args, error: formatPlanUpdatePatchTypeError(describeValueType(parsed)) };
      }
      return {
        args: { ...args, patch: parsed },
        coercedPatchSource: 'stringified',
      };
    } catch {
      return { args, error: formatPlanUpdatePatchTypeError('string') };
    }
  }

  return { args, error: formatPlanUpdatePatchTypeError(describeValueType(patch)) };
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

type PreparedToolCallRequest = {
  callId: string;
  toolName: unknown;
  rawArgs: unknown;
};

function prepareToolCallRequests(calls: any[]): PreparedToolCallRequest[] {
  return calls.map((call) => {
    const callId = call?.id || crypto.randomUUID();
    const toolName = call?.function?.name;
    const rawArgs = call?.function?.arguments;
    return { callId, toolName, rawArgs };
  });
}

type SchedulerBlockedApproval = { nodeId: string };

type SchedulerNodeResult = {
  toolResult?: ToolResult;
};

type SchedulerRunResult = {
  blockedApprovals: SchedulerBlockedApproval[];
  nodeResults: Record<string, SchedulerNodeResult | undefined>;
};

async function runToolExecutionPlan(params: {
  session: ToolCallingSessionOptions;
  phase: ExecutionPhase;
  plan: ExecutionPlan;
  signal?: AbortSignal;
}): Promise<SchedulerRunResult> {
  const scheduler = new ParallelScheduler(
    params.session.toolstack.router as ToolRouter,
    new InMemoryLockManager(),
  );

  const runSignal = params.signal ?? new AbortController().signal;
  let result = (await scheduler.run(
    params.plan,
    { ...params.session.runtime, phase: params.phase },
    runSignal,
  )) as SchedulerRunResult;

  const persistEnabled = process.env.NODE_ENV !== 'test';
  const persistenceRoot = params.session.runtime.persistenceRoot || params.session.runtime.repoRoot;
  if (persistEnabled) {
    await PlanPersistence.save(persistenceRoot, params.plan, result as any, {
      repoRoot: params.session.runtime.repoRoot,
      worktreeRoot: params.session.runtime.worktreeRoot,
      persistenceRoot: params.session.runtime.persistenceRoot,
      phase: params.phase,
      model: params.session.runtime.model,
    });
  }

  const waitForAuthorization = params.session.toolstack.router.waitForAuthorization;
  const canWaitForAuth = typeof waitForAuthorization === 'function';

  let resumeAttempts = 0;
  while (result.blockedApprovals.length > 0 && canWaitForAuth && !runSignal.aborted) {
    resumeAttempts++;
    if (resumeAttempts > 10) break;

    await Promise.all(
      result.blockedApprovals.map(async (a) => {
        await waitForAuthorization?.(a.nodeId, runSignal);
      }),
    );

    result = (await scheduler.run(
      params.plan,
      { ...params.session.runtime, phase: params.phase },
      runSignal,
      {
        initialResults: result.nodeResults as any,
        resumeBlockedApprovals: true,
      },
    )) as SchedulerRunResult;

    if (persistEnabled) {
      await PlanPersistence.save(persistenceRoot, params.plan, result as any, {
        repoRoot: params.session.runtime.repoRoot,
        worktreeRoot: params.session.runtime.worktreeRoot,
        persistenceRoot: params.session.runtime.persistenceRoot,
        phase: params.phase,
        model: params.session.runtime.model,
      });
    }
  }

  return result;
}

function applyStrictToolOutputSchemaValidation(params: {
  session: ToolCallingSessionOptions;
  phase: ExecutionPhase;
  callId: string;
  toolName: string;
  result: ToolResult;
}): void {
  if (params.result.status !== 'ok') return;

  const spec =
    params.session.toolstack.router.getSpec?.(params.toolName) ||
    params.session.toolstack.registry.listAll().find((s) => s.name === params.toolName);

  if (!spec?.outputSchema) return;

  const parsed = spec.outputSchema.safeParse(params.result.output);
  if (parsed.success) {
    params.result.output = parsed.data;
    return;
  }

  const validationError = parsed.error.message;
  getLogger().error(
    `[tool] schema violation for ${params.toolName} (callId: ${params.callId}): ${validationError}`,
  );

  params.result.status = 'error';
  params.result.error = {
    code: 'SCHEMA_VIOLATION',
    message: `Tool output does not match expected schema: ${validationError}`,
    retryable: false,
    failurePhase: params.phase,
  };
}

async function executeToolCalls(
  session: ToolCallingSessionOptions,
  phase: ExecutionPhase,
  round: number,
  calls: any[],
  messages: LLMMessage[],
  signal?: AbortSignal,
): Promise<void> {
  const prepared = prepareToolCallRequests(calls);
  const { roundCap } = initToolCallRoundBudget({
    session,
    phase,
    round,
    preparedCount: prepared.length,
  });

  const toolResults = new Map<string, ToolResult>();
  const nodes: PlanNode[] = [];
  const toolArgsPreviewByCallId = new Map<string, string>();
  const rawArgsPreviewByCallId = new Map<string, string | undefined>();
  const rawArgsTypeByCallId = new Map<string, string>();
  const patchCoercionByCallId = new Map<string, string>();

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

    let planUpdatePatchError: string | undefined;
    if (parsedArgsOk && normalizedToolName === 'plan.update' && isObjectRecord(argsValue)) {
      const patchGuard = coercePlanUpdatePatch(argsValue);
      argsValue = patchGuard.args;
      if (patchGuard.coercedPatchSource) {
        patchCoercionByCallId.set(callId, patchGuard.coercedPatchSource);
      }
      if (patchGuard.error) {
        planUpdatePatchError = patchGuard.error;
      }
    }

    if (parsedArgsOk) {
      toolArgsPreviewByCallId.set(callId, safeStringifyForAudit(argsValue));
    }

    const input =
      session.eventPayload?.includeToolInput && parsedArgsOk
        ? buildHeadlessToolInputPayload(argsValue)
        : undefined;

    const spec =
      typeof toolName === 'string'
        ? session.toolstack.registry.listAll().find((s) => s.name === toolName)
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
      toolIntent: spec?.intent,
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
      getLogger().warn('Received malformed tool call (missing function.name)');
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

    const parsedAuditEntry: any = {
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
    };
    const patchCoercionSource = patchCoercionByCallId.get(callId);
    if (patchCoercionSource) {
      parsedAuditEntry.coercedPatchSource = patchCoercionSource;
    }
    session.toolCallingAudit?.event(parsedAuditEntry);

    if (planUpdatePatchError) {
      toolResults.set(callId, {
        id: callId,
        toolName,
        source: 'builtin',
        status: 'error',
        error: {
          code: 'INVALID_INPUT',
          message: planUpdatePatchError,
          retryable: false,
          failurePhase: phase,
        },
        durationMs: 0,
      });
      continue;
    }

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

    const result = await runToolExecutionPlan({ session, phase, plan, signal });

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
    if (typeof toolName === 'string') {
      applyStrictToolOutputSchemaValidation({ session, phase, callId, toolName, result });
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

    if (
      result.status !== 'ok' &&
      result.error?.code === 'INTERRUPT_REQUIRED' &&
      result.meta?.interrupt
    ) {
      const err = new Error(result.error.message || 'Interrupt required');
      (err as any).code = 'INTERRUPT_REQUIRED';
      (err as any).interrupt = result.meta.interrupt;
      throw err;
    }

    if (result.status !== 'ok') {
      const errorCode = result.error?.code;
      const attachArgsPreview = errorCode === 'INVALID_INPUT';
      const errorAuditEntry: any = {
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
      };
      const patchCoercionSource = patchCoercionByCallId.get(callId);
      if (patchCoercionSource) {
        errorAuditEntry.coercedPatchSource = patchCoercionSource;
      }
      session.toolCallingAudit?.event(errorAuditEntry);
    } else {
      const toolResultOutputOk =
        isObjectRecord(result.output) && typeof result.output.ok === 'boolean'
          ? result.output.ok
          : undefined;
      const artifacts = extractArtifactHandlesFromToolOutput(result.output);
      const recentReadArtifact = await persistRecentReadArtifact({
        toolName: typeof toolName === 'string' ? toolName : 'unknown',
        rawArgs,
        output: result.output,
      });
      session.toolCallingAudit?.event({
        timestamp: new Date().toISOString(),
        phase,
        round,
        callId,
        toolName: typeof toolName === 'string' ? toolName : 'unknown',
        rawArgsType: rawArgsTypeByCallId.get(callId) ?? typeof rawArgs,
        parsedArgsOk: true,
        toolResultOutputOk,
        toolResultStatus: result.status,
        toolResultPatchArtifact: artifacts.patchArtifact,
        toolResultAuditArtifact: artifacts.auditArtifact,
        toolResultReadArtifact: recentReadArtifact?.artifact,
        toolResultReadArtifactPath: recentReadArtifact?.path,
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
  resetToolCallBudgetState(session);
  const messages: LLMMessage[] = [...initialMessages];
  const { allowedSpecs, openAITools } = resolveToolCallingForSession({
    session,
    phase,
    messages,
  });
  emitToolCallingEnabledLogIfNeeded(session, openAITools, allowedSpecs);
  const canonicalEmitters = createCanonicalEmitterRegistry(session);

  try {
    for (let round = 0; round < maxRounds; round++) {
      const roundStartedAt = Date.now();
      const toolCalls = new ToolCallAccumulator();
      const emittedModelToolCallIds = new Set<string>();
      const streamId = createStreamingStreamId({ session, phase, round });
      const canonicalEmitter = canonicalEmitters.get(streamId);

      let usedFallback = false;
      let finishReason: string | undefined;

      try {
        let streamContent = '';
        let finishUsage: { promptTokens: number; completionTokens: number } | undefined;
        try {
          const consumed = await consumeAssistantStreamTurn({
            session,
            messages,
            chatOptions,
            openAITools,
            allowedSpecs,
            phase,
            round,
            streamId,
            canonicalEmitter,
            emittedModelToolCallIds,
            toolCalls,
          });
          streamContent = consumed.content;
          finishReason = consumed.finishReason;
          finishUsage = consumed.finishUsage;
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

        const drainedToolCalls = toolCalls.drain();
        const fallback = await applyEmptyStreamFallback({
          session,
          messages,
          chatOptions,
          openAITools,
          allowedSpecs,
          phase,
          round,
          content: streamContent,
          collectedToolCalls: drainedToolCalls,
        });
        usedFallback = fallback.usedFallback;

        const assistant: LLMMessage = {
          role: 'assistant',
          content: fallback.content,
          tool_calls: fallback.toolCalls.length > 0 ? fallback.toolCalls : undefined,
        };

        if (session.emit && session.llmOutput) {
          emitSynthesizedFunctionCallClosures({
            emit: session.emit,
            llmOutput: session.llmOutput,
            canonicalEmitter,
            streamId,
            phase,
            round,
            collectedToolCalls: fallback.toolCalls,
            emittedModelToolCallIds,
          });
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
            contentChars: assistant.content.length,
            toolCallCount: fallback.toolCalls.length,
          },
          { source: 'llm', severity: 'low', scope: 'session', phase },
        );

        messages.push(assistant);

        const calls = assistant.tool_calls || [];
        if (!Array.isArray(calls) || calls.length === 0) {
          return assistant;
        }

        await executeToolCalls(session, phase, round, calls, messages, chatOptions.signal);
      } finally {
        canonicalEmitters.release(streamId);
      }
    }
  } finally {
    canonicalEmitters.clear();
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
