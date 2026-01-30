import { normalizePath } from '../../path.js';
import type { Context, RelatedFileContext, RipgrepResult } from '../../types.js';

function extractChangedFilesFromDiffText(diffText: string | undefined): Set<string> {
  const out = new Set<string>();
  if (!diffText) return out;

  const re = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(diffText)) !== null) {
    const file = normalizePath(match[2] || match[1] || '').replace(/^(\.\/|\/)+/, '');
    if (file) out.add(file);
  }
  return out;
}

function computeRelatedFileScore(file: RelatedFileContext, changedFiles: Set<string>): number {
  // Target file is represented by <primary_file>, not related files.
  if (file.kind === 'import') {
    return changedFiles.has(normalizePath(file.path)) ? 90 : 60;
  }

  if (file.kind === 'failed') return 95;
  if (file.kind === 'dependency') return changedFiles.has(normalizePath(file.path)) ? 85 : 55;
  return 50;
}

function stableSortByScore<T>(
  items: T[],
  getScore: (item: T) => number,
  getTieKey: (item: T) => string,
): T[] {
  return [...items].sort((a, b) => {
    const sa = getScore(a);
    const sb = getScore(b);
    if (sa !== sb) return sb - sa;
    return getTieKey(a).localeCompare(getTieKey(b));
  });
}

function rankRelatedFiles(
  related: RelatedFileContext[] | undefined,
  changedFiles: Set<string>,
): RelatedFileContext[] | undefined {
  if (!related) return related;
  return stableSortByScore(
    related,
    (f) => computeRelatedFileScore(f, changedFiles),
    (f) => normalizePath(f.path),
  );
}

function rankSnippets(snippets: RipgrepResult[]): RipgrepResult[] {
  if (!snippets || snippets.length === 0) return snippets;

  const freq = new Map<string, number>();
  for (const s of snippets) {
    const key = normalizePath(s.file);
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  return [...snippets].sort((a, b) => {
    const fa = freq.get(normalizePath(a.file)) ?? 0;
    const fb = freq.get(normalizePath(b.file)) ?? 0;
    if (fa !== fb) return fb - fa;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

export function rankContextForRelevance(context: Context): Context {
  const changed = new Set<string>([
    ...extractChangedFilesFromDiffText(context.stagedDiff),
    ...extractChangedFilesFromDiffText(context.unstagedDiff),
    ...extractChangedFilesFromDiffText(context.gitDiff),
  ]);

  return {
    ...context,
    relatedFiles: rankRelatedFiles(context.relatedFiles, changed),
    rgSnippets: rankSnippets(context.rgSnippets),
  };
}
