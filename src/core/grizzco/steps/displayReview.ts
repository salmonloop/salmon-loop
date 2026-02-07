import { text } from '../../../locales/index.js';
import type { ReviewCtx, ReviewSuggestion, ReviewSummary } from '../types.js';

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function removeLeadingSpaces(content: string): string {
  const lines = content.split('\n');

  // Find minimum indentation (excluding empty lines)
  const minIndent = lines
    .filter((line) => line.trim().length > 0)
    .reduce((min, line) => {
      const match = line.match(/^(\s*)/);
      const indent = match ? match[1].length : 0;
      return Math.min(min, indent);
    }, Infinity);

  // Remove the common indentation from all lines
  if (minIndent > 0 && minIndent !== Infinity) {
    return lines.map((line) => line.substring(minIndent)).join('\n');
  }

  return content;
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
    const cleanContent = removeLeadingSpaces(suggestion.content);
    ctx.emit({
      type: 'log',
      level: 'info',
      message: text.grizzco.review.suggestionItem(index + 1, suggestion.type, cleanContent),
      timestamp: new Date(),
    });
  });

  return ctx;
}
