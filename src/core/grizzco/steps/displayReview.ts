import { text } from '../../../locales/index.js';
import type { ReviewCtx, ReviewSuggestion, ReviewSummary } from '../types.js';

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isReviewSuggestion(value: unknown): value is ReviewSuggestion {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSuggestions(
  input: ReviewSummary['suggestions'],
): Array<{ type: string; content: string }> {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (typeof item === 'string') {
        return { type: 'note', content: item };
      }
      if (isReviewSuggestion(item)) {
        const type = typeof item.type === 'string' ? item.type : 'note';
        const content = typeof item.content === 'string' ? item.content : safeStringify(item);
        return { type, content };
      }
      return { type: 'note', content: String(item) };
    });
  }

  if (typeof input === 'string') {
    return [{ type: 'note', content: input }];
  }

  if (isReviewSuggestion(input)) {
    const type = typeof input.type === 'string' ? input.type : 'note';
    const content = typeof input.content === 'string' ? input.content : safeStringify(input);
    return [{ type, content }];
  }

  return [{ type: 'note', content: safeStringify(input) }];
}

export async function displayReview(ctx: ReviewCtx): Promise<ReviewCtx> {
  const outputKinds = ctx.options?.llmOutput?.kinds ?? [];
  if (outputKinds.includes('review')) {
    return ctx;
  }

  ctx.emit({
    type: 'log',
    level: 'info',
    message: text.grizzco.review.header,
    timestamp: new Date(),
  });

  const suggestions = normalizeSuggestions(ctx.review?.suggestions);

  if (suggestions.length === 0) {
    ctx.emit({
      type: 'log',
      level: 'info',
      message: text.grizzco.review.empty,
      timestamp: new Date(),
    });
    return ctx;
  }

  suggestions.forEach((suggestion, index) => {
    ctx.emit({
      type: 'log',
      level: 'info',
      message: text.grizzco.review.suggestionItem(index + 1, suggestion.type, suggestion.content),
      timestamp: new Date(),
    });
  });

  return ctx;
}
