import { LIMITS } from '../config/limits.js';
import { createResponseOutputTextDeltaEvent } from '../streaming/canonical/responses-event-emitter.js';
import {
  LLM_OUTPUT_KINDS,
  type ExecutionStep,
  type LlmOutputKind,
  type LlmOutputPolicy,
  type LoopEvent,
} from '../types/index.js';

const SECRET_LINE_PATTERN = /(api[-_]?key|authorization|token|secret|password|cookie)/i;
const TOKEN_LIKE_PATTERN = /[A-Za-z0-9_\-/+=]{16,}/;
const STREAM_SANITIZATION_STATE = new Map<string, { raw: string; emittedLength: number }>();

export const DEFAULT_LLM_OUTPUT_POLICY: LlmOutputPolicy = {
  kinds: ['review', 'assistant_message', 'plan'],
};

function normalizeKinds(kinds: LlmOutputKind[]): LlmOutputKind[] {
  const seen = new Set<LlmOutputKind>();
  const out: LlmOutputKind[] = [];
  for (const kind of kinds) {
    if (!LLM_OUTPUT_KINDS.includes(kind)) continue;
    if (seen.has(kind)) continue;
    seen.add(kind);
    out.push(kind);
  }
  return out;
}

export function resolveLlmOutputPolicy(input?: Partial<LlmOutputPolicy> | null): LlmOutputPolicy {
  if (!input) return { ...DEFAULT_LLM_OUTPUT_POLICY };
  if (input.kinds === undefined) return { ...DEFAULT_LLM_OUTPUT_POLICY };
  return {
    kinds: normalizeKinds(input.kinds),
  };
}

export function shouldEmitLlmOutput(
  policy: LlmOutputPolicy | undefined,
  kind: LlmOutputKind,
): boolean {
  const effective = policy ?? DEFAULT_LLM_OUTPUT_POLICY;
  return effective.kinds.includes(kind);
}

export function sanitizeLlmOutput(content: string): string {
  let output = String(content ?? '');
  if (!output) return '';

  const redacted = output.split('\n').map(redactPotentialSecretLine).join('\n');

  output = redacted.split('\u0000').join('');

  if (output.length > LIMITS.maxLogLength) {
    output = output.substring(0, LIMITS.maxLogLength) + '...';
  }

  return output;
}

function redactPotentialSecretLine(line: string): string {
  if (!SECRET_LINE_PATTERN.test(line)) return line;
  const assignment = line.match(/^(.*?)([:=]\s*)(.+)$/);
  if (assignment) {
    return `${assignment[1]}${assignment[2]}[REDACTED]`;
  }
  if (TOKEN_LIKE_PATTERN.test(line)) {
    return '[REDACTED]';
  }
  return line;
}

function sanitizeLlmStreamDelta(streamId: string, delta: string): string {
  if (!delta) return '';
  if (STREAM_SANITIZATION_STATE.size > 256 && !STREAM_SANITIZATION_STATE.has(streamId)) {
    STREAM_SANITIZATION_STATE.clear();
  }

  const state = STREAM_SANITIZATION_STATE.get(streamId) ?? { raw: '', emittedLength: 0 };
  state.raw = (state.raw + delta).split('\u0000').join('');

  // Keep bounded memory while preserving enough history for cross-chunk redaction.
  if (state.raw.length > LIMITS.maxLogLength * 4) {
    state.raw = state.raw.slice(-LIMITS.maxLogLength * 2);
    state.emittedLength = 0;
  }

  const sanitized = sanitizeLlmOutput(state.raw);
  const next = sanitized.slice(state.emittedLength);
  state.emittedLength = sanitized.length;
  STREAM_SANITIZATION_STATE.set(streamId, state);
  return next;
}

export function emitLlmOutput(params: {
  emit?: (event: LoopEvent) => void;
  policy?: LlmOutputPolicy;
  kind: LlmOutputKind;
  step: ExecutionStep;
  content: string;
}) {
  const { emit, policy, kind, step, content } = params;
  if (!emit) return;
  if (!shouldEmitLlmOutput(policy, kind)) return;
  const sanitized = sanitizeLlmOutput(content);
  if (!sanitized.trim()) return;
  emit({
    type: 'llm.output',
    kind,
    step,
    content: sanitized,
    timestamp: new Date(),
  });
}

export function emitLlmStreamDelta(params: {
  emit?: (event: LoopEvent) => void;
  policy?: LlmOutputPolicy;
  kind: LlmOutputKind;
  step: ExecutionStep;
  streamId: string;
  content: string;
}) {
  const { emit, policy, kind, step, streamId, content } = params;
  if (!emit) return;
  if (!shouldEmitLlmOutput(policy, kind)) return;
  const sanitized = sanitizeLlmStreamDelta(streamId, content);
  if (!sanitized) return;
  const timestamp = new Date();
  emit({
    type: 'llm.responses.event',
    kind,
    step,
    streamId,
    source: 'synthesized',
    event: createResponseOutputTextDeltaEvent(sanitized),
    timestamp,
  });
  emit({
    type: 'llm.stream.delta',
    kind,
    step,
    streamId,
    content: sanitized,
    timestamp,
  });
}

export function emitLlmStreamEnd(params: {
  emit?: (event: LoopEvent) => void;
  policy?: LlmOutputPolicy;
  kind: LlmOutputKind;
  step: ExecutionStep;
  streamId: string;
  finishReason?: string;
}) {
  const { emit, policy, kind, step, streamId, finishReason } = params;
  if (!emit) return;
  if (!streamId) return;
  if (!shouldEmitLlmOutput(policy, kind)) return;
  emit({
    type: 'llm.stream.end',
    kind,
    step,
    streamId,
    finishReason,
    timestamp: new Date(),
  });
}
