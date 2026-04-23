import { text } from '../../../locales/index.js';
import { emitLlmOutput } from '../../llm/output-policy.js';
import { getReviewPrompt } from '../../prompts/runtime.js';
import type { LLM } from '../../types/llm.js';
import type {
  ContextCtx,
  ReviewCtx,
  ReviewSummary,
  ReviewSuggestion,
} from '../engine/pipeline/types.js';

function normalizeReviewSuggestions(value: unknown): ReviewSummary['suggestions'] {
  if (value == null) return null;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item as ReviewSuggestion;
      return String(item);
    });
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value as ReviewSuggestion;
  return String(value);
}

function parseReviewResponse(content: string): ReviewSummary['suggestions'] {
  try {
    return normalizeReviewSuggestions(JSON.parse(content));
  } catch {
    return normalizeReviewSuggestions(content);
  }
}

export async function generateReview(ctx: ContextCtx): Promise<ReviewCtx> {
  const reviewPrompt = await getReviewPrompt(JSON.stringify(ctx.context, null, 2));
  const llmClient: LLM = ctx.options.llm;

  const response = await llmClient.chat([{ role: 'user', content: reviewPrompt }], {
    tools: [],
    signal: ctx.options.signal,
  });

  if (!response?.content) {
    throw new Error(text.llm.reviewEmpty);
  }

  emitLlmOutput({
    emit: ctx.emit,
    policy: ctx.options.llmOutput,
    kind: 'review',
    step: 'REVIEW',
    content: response.content,
  });

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.grizzco.review.generated,
    timestamp: new Date(),
  });

  const suggestions = parseReviewResponse(response.content);
  const timestamp = Date.now();

  return {
    ...ctx,
    review: {
      suggestions,
      timestamp,
    },
    report: {
      kind: 'review',
      suggestions,
      timestamp,
    },
  };
}
