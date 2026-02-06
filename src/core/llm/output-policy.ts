import { LIMITS } from '../limits.js';
import {
  LLM_OUTPUT_KINDS,
  type ExecutionStep,
  type LlmOutputKind,
  type LlmOutputPolicy,
  type LoopEvent,
} from '../types.js';

const SECRET_LINE_PATTERN = /(api[-_]?key|authorization|token|secret|password|cookie)/i;

export const DEFAULT_LLM_OUTPUT_POLICY: LlmOutputPolicy = {
  kinds: ['review', 'assistant_message'],
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

  const redacted = output
    .split('\n')
    .map((line) => {
      if (!SECRET_LINE_PATTERN.test(line)) return line;
      return line.replace(/[:=].*$/, (match) => {
        const separator = match.startsWith('=') ? '=' : ':';
        return `${separator} [REDACTED]`;
      });
    })
    .join('\n');

  output = redacted.split('\u0000').join('');

  if (output.length > LIMITS.maxLogLength) {
    output = output.substring(0, LIMITS.maxLogLength) + '...';
  }

  return output;
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
  const sanitized = sanitizeLlmOutput(content);
  if (!sanitized.trim()) return;
  emit({
    type: 'llm.stream.delta',
    kind,
    step,
    streamId,
    content: sanitized,
    timestamp: new Date(),
  });
}
