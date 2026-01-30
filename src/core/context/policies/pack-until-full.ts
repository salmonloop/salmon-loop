import { LIMITS } from '../../limits.js';
import type { Context, RipgrepResult } from '../../types.js';

export interface BudgetResult {
  context: Context;
  truncated: boolean;
}

function calculateTotalChars(context: Context): number {
  const primary = context.primaryText?.length ?? 0;
  const snippets = context.rgSnippets.reduce(
    (sum, snippet) => sum + (snippet.content?.length ?? 0),
    0,
  );
  const diff =
    (context.gitDiff?.length ?? 0) +
    (context.stagedDiff?.length ?? 0) +
    (context.unstagedDiff?.length ?? 0) +
    (context.untrackedDiff?.length ?? 0);
  return primary + snippets + diff;
}

export function packUntilFull(
  context: Context,
  budgetChars: number = LIMITS.maxContextChars,
): BudgetResult {
  const totalChars = calculateTotalChars(context);
  if (totalChars <= budgetChars) {
    return { context, truncated: false };
  }

  let remainingChars = budgetChars - (context.primaryText?.length || 0);
  if (remainingChars <= 0) {
    return {
      context: {
        ...context,
        rgSnippets: [],
        gitDiff: undefined,
      },
      truncated: true,
    };
  }

  const truncatedSnippets: RipgrepResult[] = [];
  for (const snippet of context.rgSnippets) {
    const snippetLen = snippet.content?.length ?? 0;
    if (snippetLen <= remainingChars) {
      truncatedSnippets.push(snippet);
      remainingChars -= snippetLen;
      continue;
    }

    if (remainingChars >= LIMITS.minSnippetChars) {
      truncatedSnippets.push({
        ...snippet,
        content: snippet.content.substring(0, remainingChars),
      });
    }
    break;
  }

  return {
    context: {
      ...context,
      rgSnippets: truncatedSnippets,
      gitDiff: undefined,
    },
    truncated: true,
  };
}
