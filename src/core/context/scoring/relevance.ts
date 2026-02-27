import type {
  Context,
  RelatedFileContext,
  RipgrepResult,
  RepoMap,
  SymbolMap,
} from '../../types/index.js';
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

/**
 * Compute a granular relevance score for a related file.
 *
 * Scoring Factors:
 * - Base score by kind (import, failed, dependency)
 * - Bonus for being an explicit target
 * - Bonus for being a changed file (in diff)
 * - Penalty for depth in RepoMap (distance from primary)
 * - Bonus for having definitions in SymbolMap
 */
function computeRelatedFileScore(params: {
  file: RelatedFileContext;
  changedFiles: Set<string>;
  isTarget: boolean;
  repoMap?: RepoMap;
  symbolMap?: SymbolMap;
}): number {
  const { file, changedFiles, isTarget, repoMap, symbolMap } = params;
  const normalizedPath = normalizePath(file.path).replace(/^(\.\/|\/)+/, '');

  let score = 50;

  // 1. Kind-based scoring
  if (file.kind === 'import') {
    score = changedFiles.has(normalizedPath) ? 90 : 60;
  } else if (file.kind === 'failed') {
    score = 95;
  } else if (file.kind === 'dependency') {
    score = changedFiles.has(normalizedPath) ? 85 : 55;
  }

  // 2. Explicit Target Bonus
  if (isTarget) {
    if (file.kind === 'failed') {
      score = 98;
    } else {
      score = Math.min(97, score + 30);
    }
  }

  // 3. RepoMap Depth Penalty (Attention focus)
  if (repoMap) {
    const node = repoMap.nodes.find(
      (n) => normalizePath(n.path).replace(/^(\.\/|\/)+/, '') === normalizedPath,
    );
    if (node) {
      // Penalty: -5 per level of depth from primary
      score -= node.depth * 5;
    } else if (repoMap.nodes.length > 0) {
      // Not in repo map but map exists: likely very distant or indirect
      score -= 15;
    }
  }

  // 4. SymbolMap Bonus (Semantic density)
  if (symbolMap) {
    const hasDefinition = symbolMap.nodes.some(
      (n) =>
        n.kind === 'definition' &&
        n.path &&
        normalizePath(n.path).replace(/^(\.\/|\/)+/, '') === normalizedPath,
    );
    if (hasDefinition) {
      score += 10;
    }
  }

  return score;
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
  repoMap?: RepoMap,
  symbolMap?: SymbolMap,
): RelatedFileContext[] | undefined {
  if (!related) return related;
  return stableSortByScore(
    related,
    (f) =>
      computeRelatedFileScore({
        file: f,
        changedFiles,
        isTarget: targetSet.has(normalizePath(f.path).replace(/^(\.\/|\/)+/, '')),
        repoMap,
        symbolMap,
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
    relatedFiles: rankRelatedFiles(
      context.relatedFiles,
      changed,
      targetSet,
      context.repoMap,
      context.symbolMap,
    ),
    rgSnippets: rankSnippets(context.rgSnippets, targetSet),
  };
}
