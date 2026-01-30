import { text } from '../../../locales/index.js';
import { LIMITS } from '../../limits.js';
import type { Context, RelatedFileContext, RipgrepResult } from '../../types.js';

export interface BudgetResult {
  context: Context;
  truncated: boolean;
}

function calculateTotalChars(context: Context): number {
  const primary = context.primaryText?.length ?? 0;
  const related =
    context.relatedFiles?.reduce((sum, file) => sum + (file.content?.length ?? 0), 0) ?? 0;
  const snippets = context.rgSnippets.reduce(
    (sum, snippet) => sum + (snippet.content?.length ?? 0),
    0,
  );
  const diff =
    (context.gitDiff?.length ?? 0) +
    (context.stagedDiff?.length ?? 0) +
    (context.unstagedDiff?.length ?? 0) +
    (context.untrackedDiff?.length ?? 0);
  return primary + related + snippets + diff;
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
        relatedFiles: [],
        rgSnippets: [],
        gitDiff: undefined,
        stagedDiff: undefined,
        unstagedDiff: undefined,
        untrackedDiff: undefined,
      },
      truncated: true,
    };
  }

  const truncatedRelated: RelatedFileContext[] = [];
  for (const file of context.relatedFiles ?? []) {
    const len = file.content?.length ?? 0;
    if (len <= remainingChars) {
      truncatedRelated.push(file);
      remainingChars -= len;
      continue;
    }

    const outline = file.outline;
    if (outline && outline.length <= remainingChars && outline.length >= LIMITS.minSnippetChars) {
      const outlineContent = `${outline}\n\n${text.context.relatedContentTruncated}`;
      truncatedRelated.push({
        ...file,
        mode: 'outline',
        content: outlineContent,
        outline: undefined,
      });
      remainingChars -= outlineContent.length;
      continue;
    }

    if (remainingChars >= LIMITS.minSnippetChars) {
      truncatedRelated.push({
        ...file,
        mode: 'outline',
        content: file.content.substring(0, remainingChars),
        outline: undefined,
      });
      remainingChars = 0;
    }
    break;
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
      relatedFiles: truncatedRelated,
      rgSnippets: truncatedSnippets,
      gitDiff: undefined,
      stagedDiff: undefined,
      unstagedDiff: undefined,
      untrackedDiff: undefined,
    },
    truncated: true,
  };
}
