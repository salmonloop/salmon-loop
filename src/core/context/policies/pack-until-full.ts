import { text } from '../../../locales/index.js';
import { LIMITS } from '../../config/limits.js';
import type { Context, RelatedFileContext, RipgrepResult } from '../../types/index.js';

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

function calculateDiffChars(context: Context): number {
  return (
    (context.gitDiff?.length ?? 0) +
    (context.stagedDiff?.length ?? 0) +
    (context.unstagedDiff?.length ?? 0) +
    (context.untrackedDiff?.length ?? 0)
  );
}

function reserveDiffBudget(totalBudgetChars: number): number {
  const quarter = Math.floor(totalBudgetChars * 0.25);
  const half = Math.floor(totalBudgetChars * 0.5);
  return Math.min(Math.max(quarter, 200), Math.min(half, 10_000));
}

function truncateWithMarker(content: string, maxChars: number, minChars: number): string | undefined {
  if (maxChars < minChars) return undefined;
  if (content.length <= maxChars) return content;

  const marker = `\n${text.context.contentTruncated}\n`;
  const sliceLen = Math.max(0, maxChars - marker.length);
  if (sliceLen < minChars) return content.substring(0, maxChars);
  return `${content.substring(0, sliceLen)}${marker}`;
}

export function packUntilFull(
  context: Context,
  budgetChars: number = LIMITS.maxContextChars,
): BudgetResult {
  const totalChars = calculateTotalChars(context);
  if (totalChars <= budgetChars) {
    return { context, truncated: false };
  }

  const primaryLen = context.primaryText?.length || 0;
  const diffChars = calculateDiffChars(context);
  const reservedForDiff = diffChars > 0 ? reserveDiffBudget(budgetChars) : 0;

  const remainingChars = budgetChars - primaryLen;
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

  let remainingNonDiffChars = Math.max(0, remainingChars - reservedForDiff);

  const truncatedRelated: RelatedFileContext[] = [];
  for (const file of context.relatedFiles ?? []) {
    const len = file.content?.length ?? 0;
    if (len <= remainingNonDiffChars) {
      truncatedRelated.push(file);
      remainingNonDiffChars -= len;
      continue;
    }

    const outline = file.outline;
    if (
      outline &&
      outline.length <= remainingNonDiffChars &&
      outline.length >= LIMITS.minSnippetChars
    ) {
      const outlineContent = `${outline}\n\n${text.context.relatedContentTruncated}`;
      truncatedRelated.push({
        ...file,
        mode: 'outline',
        content: outlineContent,
        outline: undefined,
      });
      remainingNonDiffChars -= outlineContent.length;
      continue;
    }

    if (remainingNonDiffChars >= LIMITS.minSnippetChars) {
      truncatedRelated.push({
        ...file,
        mode: 'outline',
        content: file.content.substring(0, remainingNonDiffChars),
        outline: undefined,
      });
      remainingNonDiffChars = 0;
    }
    break;
  }

  const truncatedSnippets: RipgrepResult[] = [];
  for (const snippet of context.rgSnippets) {
    const snippetLen = snippet.content?.length ?? 0;
    if (snippetLen <= remainingNonDiffChars) {
      truncatedSnippets.push(snippet);
      remainingNonDiffChars -= snippetLen;
      continue;
    }

    if (remainingNonDiffChars >= LIMITS.minSnippetChars) {
      truncatedSnippets.push({
        ...snippet,
        content: snippet.content.substring(0, remainingNonDiffChars),
      });
    }
    break;
  }

  const usedNonDiffChars =
    truncatedRelated.reduce((sum, f) => sum + (f.content?.length ?? 0), 0) +
    truncatedSnippets.reduce((sum, s) => sum + (s.content?.length ?? 0), 0);
  let remainingDiffChars = Math.max(0, remainingChars - usedNonDiffChars);

  const minDiffChars = 32;
  const stagedDiff = context.stagedDiff
    ? truncateWithMarker(context.stagedDiff, remainingDiffChars, minDiffChars)
    : undefined;
  if (stagedDiff) remainingDiffChars -= stagedDiff.length;

  const unstagedDiff = context.unstagedDiff
    ? truncateWithMarker(context.unstagedDiff, remainingDiffChars, minDiffChars)
    : undefined;
  if (unstagedDiff) remainingDiffChars -= unstagedDiff.length;

  const gitDiff =
    !stagedDiff && !unstagedDiff && context.gitDiff
      ? truncateWithMarker(context.gitDiff, remainingDiffChars, minDiffChars)
      : undefined;
  if (gitDiff) remainingDiffChars -= gitDiff.length;

  const untrackedDiff = context.untrackedDiff
    ? truncateWithMarker(context.untrackedDiff, remainingDiffChars, minDiffChars)
    : undefined;

  return {
    context: {
      ...context,
      relatedFiles: truncatedRelated,
      rgSnippets: truncatedSnippets,
      stagedDiff,
      unstagedDiff,
      gitDiff,
      untrackedDiff,
    },
    truncated: true,
  };
}
