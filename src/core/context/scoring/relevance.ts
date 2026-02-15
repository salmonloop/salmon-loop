import type { Context, RelatedFileContext, RipgrepResult } from '../../types/index.js';
import { normalizePath } from '../../utils/path.js';

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

function buildTargetSet(context: Context): Set<string> {
  const out = new Set<string>();
  for (const t of context.targets ?? []) {
    const p = normalizePath(t.path).replace(/^(\.\/|\/)+/, '');
    if (p) out.add(p);
  }
  if (context.primaryFile) {
    const p = normalizePath(context.primaryFile).replace(/^(\.\/|\/)+/, '');
    if (p) out.add(p);
  }
  return out;
}

function computeRelatedFileScore(params: {
  file: RelatedFileContext;
  changedFiles: Set<string>;
  isTarget: boolean;
}): number {
  const { file, changedFiles, isTarget } = params;
  // Target file is represented by <primary_file>, not related files.
  const normalizedPath = normalizePath(file.path).replace(/^(\.\/|\/)+/, '');

  let base = 50;
  if (file.kind === 'import') {
    base = changedFiles.has(normalizedPath) ? 90 : 60;
  } else if (file.kind === 'failed') {
    base = 95;
  } else if (file.kind === 'dependency') {
    base = changedFiles.has(normalizedPath) ? 85 : 55;
  }

  if (!isTarget) return base;
  if (file.kind === 'failed') return 98;
  return Math.min(97, base + 30);
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
  targetSet: Set<string>,
): RelatedFileContext[] | undefined {
  if (!related) return related;
  return stableSortByScore(
    related,
    (f) =>
      computeRelatedFileScore({
        file: f,
        changedFiles,
        isTarget: targetSet.has(normalizePath(f.path).replace(/^(\.\/|\/)+/, '')),
      }),
    (f) => normalizePath(f.path).replace(/^(\.\/|\/)+/, ''),
  );
}

function rankSnippets(snippets: RipgrepResult[], targetSet: Set<string>): RipgrepResult[] {
  if (!snippets || snippets.length === 0) return snippets;

  const freq = new Map<string, number>();
  for (const s of snippets) {
    const key = normalizePath(s.file).replace(/^(\.\/|\/)+/, '');
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  return [...snippets].sort((a, b) => {
    const aPath = normalizePath(a.file).replace(/^(\.\/|\/)+/, '');
    const bPath = normalizePath(b.file).replace(/^(\.\/|\/)+/, '');
    const aIsTarget = targetSet.has(aPath);
    const bIsTarget = targetSet.has(bPath);
    if (aIsTarget !== bIsTarget) return aIsTarget ? -1 : 1;

    const fa = freq.get(aPath) ?? 0;
    const fb = freq.get(bPath) ?? 0;
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
  const targetSet = buildTargetSet(context);

  return {
    ...context,
    relatedFiles: rankRelatedFiles(context.relatedFiles, changed, targetSet),
    rgSnippets: rankSnippets(context.rgSnippets, targetSet),
  };
}
