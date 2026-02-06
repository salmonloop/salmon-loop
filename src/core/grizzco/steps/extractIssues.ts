import { text } from '../../../locales/index.js';
import type { ReviewCtx, ReviewSuggestion, ReviewSummary } from '../types.js';

function isReviewSuggestion(value: unknown): value is ReviewSuggestion {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectIssues(suggestions: ReviewSummary['suggestions']): ReviewSuggestion[] {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter((item): item is ReviewSuggestion => {
    if (!isReviewSuggestion(item)) return false;
    const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
    return type === 'bug' || type === 'security' || type === 'vulnerability';
  });
}

export async function extractIssues(ctx: ReviewCtx): Promise<ReviewCtx> {
  const issues = collectIssues(ctx.review?.suggestions);

  if (issues.length > 0) {
    ctx.emit({
      type: 'log',
      level: 'info',
      message: text.grizzco.review.issuesExtracted(issues.length),
      timestamp: new Date(),
    });
  }

  return ctx;
}
