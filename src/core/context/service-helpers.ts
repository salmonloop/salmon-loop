import type { Context } from '../types/context.js';

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Operation cancelled by user');
  }
}

export function calculateUsedChars(context: Context): number {
  const primary = context.primaryText?.length ?? 0;
  const related = context.relatedFiles?.reduce((sum, f) => sum + (f.content?.length ?? 0), 0) ?? 0;
  const snippets = context.rgSnippets.reduce((sum, s) => sum + (s.content?.length ?? 0), 0);
  const diff =
    (context.gitDiff?.length ?? 0) +
    (context.stagedDiff?.length ?? 0) +
    (context.unstagedDiff?.length ?? 0) +
    (context.untrackedDiff?.length ?? 0);
  return primary + related + snippets + diff;
}

export function calculateSectionChars(context: Context) {
  const primary = context.primaryText?.length ?? 0;
  const relatedFiles =
    context.relatedFiles?.reduce((sum, f) => sum + (f.content?.length ?? 0), 0) ?? 0;
  const rgSnippets = context.rgSnippets.reduce((sum, s) => sum + (s.content?.length ?? 0), 0);
  const diffs =
    (context.gitDiff?.length ?? 0) +
    (context.stagedDiff?.length ?? 0) +
    (context.unstagedDiff?.length ?? 0) +
    (context.untrackedDiff?.length ?? 0);
  return {
    primary,
    relatedFiles,
    rgSnippets,
    diffs,
    total: primary + relatedFiles + rgSnippets + diffs,
  };
}
