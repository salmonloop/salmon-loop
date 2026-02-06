import { text } from '../../../locales/index.js';
import type { ReviewCtx } from '../types.js';

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeSuggestions(input: unknown): Array<{ type: string; content: string }> {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map((item) => {
      if (typeof item === 'string') {
        return { type: 'note', content: item };
      }
      if (item && typeof item === 'object') {
        const type = typeof (item as any).type === 'string' ? (item as any).type : 'note';
        const content =
          typeof (item as any).content === 'string' ? (item as any).content : safeStringify(item);
        return { type, content };
      }
      return { type: 'note', content: String(item) };
    });
  }

  if (typeof input === 'string') {
    return [{ type: 'note', content: input }];
  }

  return [{ type: 'note', content: safeStringify(input) }];
}

export async function displayReview(ctx: ReviewCtx): Promise<ReviewCtx> {
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
