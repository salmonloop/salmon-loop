import { text } from '../../../locales/index.js';
import type { ReviewCtx } from '../types.js';

function collectIssues(suggestions: unknown): unknown[] {
  if (!Array.isArray(suggestions)) return [];
  return suggestions.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const type = String((item as any).type || '').toLowerCase();
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
