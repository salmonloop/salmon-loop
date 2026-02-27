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

function extractKeywords(instruction: string | undefined): string[] {
  if (!instruction) return [];
  // Basic keyword extraction: split by non-alphanumeric, filter short words
  return instruction
    .toLowerCase()
    .split(/[^a-z0-9_]/)
    .filter((word) => word.length >= 3);
}

/**
 * Compute a granular relevance score for a related file.
 */
function computeRelatedFileScore(params: {
  file: RelatedFileContext;
  changedFiles: Set<string>;
  isTarget: boolean;
  repoMap?: RepoMap;
  symbolMap?: SymbolMap;
  keywords: string[];
  primaryFile?: string;
}): number {
  const { file, changedFiles, isTarget, repoMap, symbolMap, keywords, primaryFile } = params;
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

  // 3. RepoMap Depth Penalty
  if (repoMap) {
    const node = repoMap.nodes.find(
      (n) => normalizePath(n.path).replace(/^(\.\/|\/)+/, '') === normalizedPath,
    );
    if (node) {
      score -= node.depth * 5;
    } else if (repoMap.nodes.length > 0) {
      score -= 15;
    }
  }

  // 4. Instruction Keyword Bonus (Path-based)
  const fileNameLower = normalizedPath.toLowerCase();
  const pathTokens = fileNameLower.split(/[^a-z0-9]/).filter((t) => t.length >= 3);

  for (const kw of keywords) {
    const matchesPath = pathTokens.some((t) => kw.includes(t) || t.includes(kw));
    if (matchesPath) {
      score += 15;
      break;
    }
  }

  // 5. Symbol Analysis
  if (symbolMap) {
    const fileSymbols = symbolMap.nodes.filter(
      (n) => n.path && normalizePath(n.path).replace(/^(\.\/|\/)+/, '') === normalizedPath,
    );

    const hasDefinition = fileSymbols.some((n) => n.kind === 'definition');
    if (hasDefinition) {
      score += 10;
    }

    // 6. Instruction Keyword Bonus (Symbol-based)
    for (const kw of keywords) {
      const matchesSymbol = fileSymbols.some((s) => {
        const symLower = s.name.toLowerCase();
        return symLower.includes(kw) || kw.includes(symLower);
      });
      if (matchesSymbol) {
        score += 10;
        break;
      }
    }

    // 7. Call Density Bonus
    if (primaryFile) {
      const normalizedPrimary = normalizePath(primaryFile).replace(/^(\.\/|\/)+/, '');
      const callCount = symbolMap.edges.filter((e) => {
        if (e.type !== 'call') return false;
        const fromNode = symbolMap.nodes.find((n) => n.id === e.from);
        const toNode = symbolMap.nodes.find((n) => n.id === e.to);
        return (
          fromNode?.path &&
          normalizePath(fromNode.path).replace(/^(\.\/|\/)+/, '') === normalizedPrimary &&
          toNode?.path &&
          normalizePath(toNode.path).replace(/^(\.\/|\/)+/, '') === normalizedPath
        );
      }).length;

      if (callCount > 0) {
        score += Math.min(15, callCount * 3);
      }
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
  repoMap: RepoMap | undefined,
  symbolMap: SymbolMap | undefined,
  keywords: string[],
  primaryFile: string | undefined,
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
        keywords,
        primaryFile,
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

/**
 * Ranks context items by relevance to the primary task and instruction.
 *
 * This implementation uses a multi-factor scoring engine (Semantic Probe) that considers:
 * - Direct targets and diffs
 * - AST symbol density and call frequency
 * - Instruction keyword alignment
 * - Dependency graph distance
 */
export function rankContextForRelevance(context: Context): Context {
  const changed = new Set<string>([
    ...extractChangedFilesFromDiffText(context.stagedDiff),
    ...extractChangedFilesFromDiffText(context.unstagedDiff),
    ...extractChangedFilesFromDiffText(context.gitDiff),
  ]);
  const targetSet = buildTargetSet(context);
  const keywords = extractKeywords(context.instruction);

  return {
    ...context,
    relatedFiles: rankRelatedFiles(
      context.relatedFiles,
      changed,
      targetSet,
      context.repoMap,
      context.symbolMap,
      keywords,
      context.primaryFile,
    ),
    rgSnippets: rankSnippets(context.rgSnippets, targetSet),
  };
}
