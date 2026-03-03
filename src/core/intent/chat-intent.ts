import { z } from 'zod';

import type { FlowMode, LLM, LLMMessage } from '../types/index.js';

export type ChatIntent = 'answer' | FlowMode;

export interface ChatIntentDecision {
  intent: ChatIntent;
  confidence: number; // 0..1
  classifier: 'heuristic' | 'llm' | 'fallback';
  reason: string;
}

export interface RouteChatIntentOptions {
  llm: LLM;
  signal?: AbortSignal;
}

const LlmDecisionSchema = z
  .object({
    intent: z.enum(['answer', 'review', 'patch', 'debug', 'research']),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1).max(300),
  })
  .strict();

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalize(input: string): string {
  return String(input ?? '').trim();
}

function routeHeuristic(input: string): ChatIntentDecision {
  const text = normalize(input);
  const lower = text.toLowerCase();

  // Strong signals: explicit diffs
  if (lower.includes('diff --git') || lower.includes('@@') || lower.includes('+++ b/')) {
    return {
      intent: 'patch',
      confidence: 0.98,
      classifier: 'heuristic',
      reason: 'diff_markers_detected',
    };
  }

  // Strong signals: errors / stack traces / failing checks
  const errorSignals = [
    'traceback (most recent call last)',
    'exception',
    'error:',
    'panic:',
    'segmentation fault',
    'assertionerror',
    'typeerror',
    'referenceerror',
    'syntaxerror',
    'cannot find module',
    'module not found',
    'failed',
    'fail:',
    'bun test',
    'test:unit',
    'test:full',
    'vitest',
    'jest',
    'eslint',
    'ts',
  ];
  const hasErrorSignal =
    errorSignals.some((s) => lower.includes(s)) || /\bat\s+\S+:\d+:\d+\b/.test(lower);
  if (hasErrorSignal) {
    return {
      intent: 'debug',
      confidence: 0.9,
      classifier: 'heuristic',
      reason: 'error_signal_detected',
    };
  }

  // Review-like requests
  const reviewSignals = [
    'review',
    'code review',
    'audit',
    'security',
    'performance',
    'lint',
    'best practice',
  ];
  if (reviewSignals.some((s) => lower.includes(s))) {
    return {
      intent: 'review',
      confidence: 0.82,
      classifier: 'heuristic',
      reason: 'review_signal_detected',
    };
  }

  // Edit-like verbs (moderate confidence)
  const editSignals = [
    'fix',
    'implement',
    'add',
    'remove',
    'refactor',
    'rename',
    'update',
    'change',
    'create',
    'delete',
    'optimize',
    'support',
    'migrate',
  ];
  if (editSignals.some((s) => lower.includes(s))) {
    return {
      intent: 'patch',
      confidence: 0.72,
      classifier: 'heuristic',
      reason: 'edit_signal_detected',
    };
  }

  // Default heuristic: answer
  return {
    intent: 'answer',
    confidence: 0.55,
    classifier: 'heuristic',
    reason: 'default_answer',
  };
}

function shouldCallLlmHeuristic(decision: ChatIntentDecision, input: string): boolean {
  if (decision.confidence >= 0.8) return false;
  // Prefer LLM classification for non-trivial or non-ASCII inputs where English heuristics are weak.
  const hasNonAscii = (() => {
    for (let i = 0; i < input.length; i++) {
      if (input.charCodeAt(i) > 127) return true;
    }
    return false;
  })();
  // Note: this improves classification quality for multilingual inputs, but it adds one extra LLM roundtrip
  // before emitting the first "intent routed" log in chat mode.
  if (hasNonAscii) return true;
  if (decision.intent === 'answer' && decision.confidence < 0.7) return true;
  return false;
}

async function routeByLlm(
  input: string,
  options: RouteChatIntentOptions,
): Promise<ChatIntentDecision> {
  const system = [
    'You are an intent router for a coding assistant.',
    'Classify the user message into exactly one intent:',
    '- answer: explain, answer questions, or give guidance; no repository mutation.',
    '- review: analyze existing code and provide suggestions; no repository mutation.',
    '- patch: user is requesting code changes, new features, or refactors.',
    '- debug: user is reporting an error/failing tests/logs and wants it fixed.',
    'Return a JSON object with keys: intent, confidence (0..1), reason.',
    'Return JSON only.',
  ].join('\n');

  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: input },
  ];

  const res = await options.llm.chat(messages, {
    temperature: 0,
    responseFormat: 'json_object',
    signal: options.signal,
    tools: [],
    toolChoice: 'none',
  });

  const raw = String(res?.content ?? '').trim();
  const parsed = JSON.parse(raw);
  const value = LlmDecisionSchema.parse(parsed);

  const intent = value.intent as ChatIntent;
  const confidence = clamp01(value.confidence);

  // Safety gating: default to non-mutating intent if confidence is low.
  const mutating = intent === 'patch' || intent === 'debug';
  if (mutating && confidence < 0.6) {
    return {
      intent: 'answer',
      confidence: 1 - confidence,
      classifier: 'llm',
      reason: `downgraded_low_confidence:${value.reason}`,
    };
  }

  return {
    intent,
    confidence,
    classifier: 'llm',
    reason: value.reason,
  };
}

export async function routeChatIntent(
  input: string,
  options: RouteChatIntentOptions,
): Promise<ChatIntentDecision> {
  const normalized = normalize(input);
  if (!normalized) {
    return {
      intent: 'answer',
      confidence: 1,
      classifier: 'fallback',
      reason: 'empty_input',
    };
  }

  const heuristic = routeHeuristic(normalized);
  if (!shouldCallLlmHeuristic(heuristic, normalized)) return heuristic;

  try {
    return await routeByLlm(normalized, options);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ...heuristic,
      classifier: 'fallback',
      reason: `llm_classification_failed:${msg}`,
    };
  }
}
