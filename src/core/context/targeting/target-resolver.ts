import type { BaseDslContext, DecisionEngine } from '../../grizzco/dsl/DecisionEngine.js';
import { MicroTaskRunner } from '../../grizzco/dsl/MicroTaskRunner.js';
import { getLogger } from '../../observability/logger.js';
import type {
  CodeLocation,
  ContextTarget,
  SymbolMap,
  TargetEvidence,
} from '../../types/context.js';
import { normalizePath } from '../../utils/path.js';
import { createTargetSetSignature } from '../hash.js';
import type { ContextRequest } from '../types.js';

import { getChurnRankingPolicy, type ChurnRankingPolicy } from './churn-policy.js';

interface TargetingDslContext extends BaseDslContext {
  repoPath: string;
  primaryFile?: string;
  instruction: string;
  data?: Record<string, unknown>;
}

function reasonRank(reason: ContextTarget['reason']): number {
  switch (reason) {
    case 'explicit_path':
      return 100;
    case 'symbol_definition':
      return 90;
    case 'diff_included':
      return 80;
    case 'primary':
      return 70;
    case 'import_neighbor':
      return 60;
    case 'rg_hit':
      return 50;
    case 'fallback':
      return 10;
    default:
      return 0;
  }
}

function confidenceRank(confidence: ContextTarget['confidence']): number {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

function mergeEvidence(
  existing: string | TargetEvidence | undefined,
  next: string | TargetEvidence | undefined,
): string | TargetEvidence | undefined {
  if (!existing) return next;
  if (!next) return existing;

  // If both are strings, concatenate
  if (typeof existing === 'string' && typeof next === 'string') {
    if (existing.includes(next)) return existing;
    return `${existing};${next}`;
  }

  // If either is structured, prefer structured
  if (typeof existing === 'object') return existing;
  if (typeof next === 'object') return next;

  return existing;
}

function dedupeTargets(targets: ContextTarget[]): ContextTarget[] {
  const seen = new Set<string>();
  const out: ContextTarget[] = [];
  for (const t of targets) {
    const key = normalizePath(t.path).replace(/^(\.\/|\/)+/, '');
    if (!key) continue;
    const idx = out.findIndex((x) => normalizePath(x.path).replace(/^(\.\/|\/)+/, '') === key);
    if (idx === -1) {
      seen.add(key);
      out.push({ ...t, path: key });
      continue;
    }

    const existing = out[idx]!;
    const existingScore = reasonRank(existing.reason) * 10 + confidenceRank(existing.confidence);
    const nextScore = reasonRank(t.reason) * 10 + confidenceRank(t.confidence);
    if (nextScore > existingScore) {
      out[idx] = { ...t, path: key, evidence: mergeEvidence(existing.evidence, t.evidence) };
    } else {
      out[idx] = { ...existing, evidence: mergeEvidence(existing.evidence, t.evidence) };
    }
  }
  return out;
}

function applyChurnWeights(
  targets: ContextTarget[],
  churnByFile: Record<string, number> | undefined,
  primaryFile: string | undefined,
  churnPolicy: ChurnRankingPolicy,
): ContextTarget[] {
  const normalizedPrimary = primaryFile
    ? normalizePath(primaryFile).replace(/^(\.\/|\/)+/, '')
    : undefined;
  const maxChurn = Math.max(...Object.values(churnByFile ?? {}), 1);
  const hasChurn = Boolean(churnByFile && Object.keys(churnByFile).length > 0);

  return [...targets]
    .map((target) => {
      const normalized = normalizePath(target.path).replace(/^(\.\/|\/)+/, '');
      const churnCount = hasChurn ? (churnByFile?.[normalized] ?? 0) : 0;
      const churnScore = churnCount > 0 ? Number((churnCount / maxChurn).toFixed(4)) : 0;
      const semanticScore = reasonRank(target.reason) * 10 + confidenceRank(target.confidence);
      const primaryBoostScore =
        normalizedPrimary && normalized === normalizedPrimary ? churnPolicy.primaryBoost : 0;
      const finalScore =
        semanticScore + primaryBoostScore + churnScore * Math.max(churnPolicy.rerankWeight, 0);
      return {
        ...target,
        churnWeight: churnScore,
        ranking: {
          semanticScore,
          churnScore,
          primaryBoostScore,
          finalScore: Number(finalScore.toFixed(6)),
        },
      };
    })
    .sort((a, b) => {
      const aPath = normalizePath(a.path).replace(/^(\.\/|\/)+/, '');
      const bPath = normalizePath(b.path).replace(/^(\.\/|\/)+/, '');
      const finalScoreDiff = (b.ranking?.finalScore ?? 0) - (a.ranking?.finalScore ?? 0);
      if (finalScoreDiff !== 0) return finalScoreDiff;

      const tieBreakDiff =
        ((b.churnWeight ?? 0) - (a.churnWeight ?? 0)) * Math.max(churnPolicy.tieBreakWeight, 0);
      if (tieBreakDiff !== 0) return tieBreakDiff;

      const semanticDiff = (b.ranking?.semanticScore ?? 0) - (a.ranking?.semanticScore ?? 0);
      if (semanticDiff !== 0) return semanticDiff;

      return aPath.localeCompare(bPath);
    });
}

function buildPrimaryTarget(primaryFile: string | undefined): ContextTarget[] {
  if (!primaryFile) return [];
  return [{ path: primaryFile, reason: 'primary', confidence: 'high' }];
}

function buildExplicitTargets(req: ContextRequest): ContextTarget[] {
  if (!req.instruction) return [];

  const matches = req.instruction.match(
    /(?:^|[\s"'`([{])((?:\.{0,2}\/)?[\w./-]+\.(?:ts|tsx|js|jsx|json|md|yml|yaml|css|scss|html))(?:$|[\s"'`)\]}.,;:])/g,
  );
  if (!matches) return [];

  const candidates = matches
    .map((m) => m.replace(/^[\s"'`([{]+/, '').replace(/[\s"'`)\]}.,;:]+$/, ''))
    .filter(Boolean)
    .map((p) => normalizePath(p).replace(/^(\.\/|\/)+/, ''));

  return dedupeTargets(
    candidates.map((path) => ({
      path,
      reason: 'explicit_path',
      confidence: 'high',
      evidence: 'instruction_path',
    })),
  );
}

function buildDiffTargets(includedFiles: string[]): ContextTarget[] {
  if (!includedFiles || includedFiles.length === 0) return [];
  return dedupeTargets(
    includedFiles.map((path) => ({
      path,
      reason: 'diff_included',
      confidence: 'high',
      evidence: 'git_diff_scope',
    })),
  );
}

function buildImportNeighborTargets(importRelated: string[], limit: number): ContextTarget[] {
  if (!importRelated || importRelated.length === 0) return [];
  return dedupeTargets(
    importRelated.slice(0, limit).map((path) => ({
      path,
      reason: 'import_neighbor',
      confidence: 'medium',
      evidence: 'primary_import',
    })),
  );
}

function buildRgHitTargets(rgHitFiles: string[], limit: number): ContextTarget[] {
  if (!rgHitFiles || rgHitFiles.length === 0) return [];
  return dedupeTargets(
    rgHitFiles.slice(0, limit).map((path) => ({
      path,
      reason: 'rg_hit',
      confidence: 'medium',
      evidence: 'rg_match',
    })),
  );
}

function extractSymbolCandidates(instruction: string): string[] {
  const raw = instruction.trim();
  if (!raw) return [];

  const out: string[] = [];

  const backtickRe = /`([^`]{1,64})`/g;
  let m: RegExpExecArray | null;
  while ((m = backtickRe.exec(raw)) !== null) {
    const v = m[1]?.trim();
    if (v) out.push(v);
  }

  const identRe = /\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g;
  while ((m = identRe.exec(raw)) !== null) {
    if (m[0]) out.push(m[0]);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of out) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique.slice(0, 20);
}

interface DiffusionMetrics {
  totalCandidates: number;
  selectedTargets: number;
  budgetLimit?: number;
  sourceBreakdown?: {
    fromDefinitionMap: number;
    fromSymbolMap: number;
  };
}

function calculateEdgeWeight(edge: {
  type: 'reference' | 'call';
  confidence: 'high' | 'medium' | 'low';
}): number {
  const typeWeight = edge.type === 'call' ? 3 : 1;
  const confidenceWeight = edge.confidence === 'high' ? 3 : edge.confidence === 'medium' ? 2 : 1;
  return typeWeight + confidenceWeight;
}

function buildSymbolTargets(params: {
  primaryFile: string;
  instruction: string;
  definitionMap: Record<string, CodeLocation> | undefined;
  symbolMap?: SymbolMap;
  diffusionDepth?: number;
  maxDiffusionTargets?: number;
}): {
  targets: ContextTarget[];
  candidates: string[];
  matched: string[];
  metrics: DiffusionMetrics;
} {
  const candidates = extractSymbolCandidates(params.instruction);
  if (candidates.length === 0) {
    return {
      targets: [],
      candidates,
      matched: [],
      metrics: { totalCandidates: 0, selectedTargets: 0 },
    };
  }

  const maxDepth = params.diffusionDepth ?? 1;
  const budget = params.maxDiffusionTargets;
  const map = params.definitionMap;
  const symbolNodes = params.symbolMap?.nodes ?? [];
  const symbolEdges = params.symbolMap?.edges ?? [];
  const nodeById = new Map(symbolNodes.map((n) => [n.id, n]));

  const matched: string[] = [];
  const targets: ContextTarget[] = [];
  const seenMatch = new Set<string>();
  let fromDefinitionMap = 0;
  let fromSymbolMap = 0;

  for (const name of candidates) {
    const lower = name.toLowerCase();
    const byDefinitionMap = map?.[name];
    if (byDefinitionMap) {
      if (!seenMatch.has(lower)) {
        matched.push(name);
        seenMatch.add(lower);
      }
      targets.push({
        path: params.primaryFile,
        reason: 'symbol_definition',
        confidence: 'high',
        evidence: `symbol:${name}@${byDefinitionMap.start.line}:${byDefinitionMap.start.column}`,
      });
      fromDefinitionMap++;
    }

    const defNodes = symbolNodes.filter(
      (n) => n.kind === 'definition' && n.name.toLowerCase() === lower,
    );
    if (defNodes.length > 0 && !seenMatch.has(lower)) {
      matched.push(name);
      seenMatch.add(lower);
    }

    for (const defNode of defNodes) {
      const defPath = defNode.path || params.primaryFile;
      targets.push({
        path: defPath,
        reason: 'symbol_definition',
        confidence: 'high',
        evidence: `symbol_node:${defNode.name}@${defNode.location.start.line}:${defNode.location.start.column}`,
      });
      fromSymbolMap++;

      // Multi-level diffusion with distance and weight control
      // Support both forward diffusion (callers) and backward diffusion (dependencies)
      const diffusionQueue: Array<{ nodeId: string; distance: number; weight: number }> = [
        { nodeId: defNode.id, distance: 0, weight: 0 },
      ];
      const visited = new Set<string>([defNode.id]);
      const diffusionTargets: Array<{
        path: string;
        confidence: ContextTarget['confidence'];
        weight: number;
        evidence: string;
      }> = [];

      // Special handling: include references in the same file as the definition
      // These represent dependencies of the definition (e.g., helper calls utility)
      // They are at distance 1, but the definitions they point to are at distance 2
      const sameFileRefs = symbolNodes.filter(
        (n) =>
          n.kind === 'reference' &&
          n.id !== defNode.id &&
          (n.path || params.primaryFile) === defPath,
      );

      for (const refNode of sameFileRefs) {
        if (visited.has(refNode.id)) continue;
        visited.add(refNode.id);

        // Add the reference node to the queue at distance 1
        // It will be processed in the BFS loop to find its target definitions
        diffusionQueue.push({
          nodeId: refNode.id,
          distance: 1,
          weight: 0,
        });
      }

      while (diffusionQueue.length > 0) {
        const current = diffusionQueue.shift()!;
        if (current.distance >= maxDepth) continue;

        // Forward diffusion: find callers (edges pointing TO current node)
        const incomingEdges = symbolEdges.filter((e) => e.to === current.nodeId);

        for (const edge of incomingEdges) {
          const callerNode = nodeById.get(edge.from);
          if (!callerNode || visited.has(callerNode.id)) continue;
          visited.add(callerNode.id);

          const edgeWeight = calculateEdgeWeight(edge);
          const totalWeight = current.weight + edgeWeight;
          const callerPath = callerNode.path || params.primaryFile;

          if (current.distance + 1 <= maxDepth) {
            diffusionTargets.push({
              path: callerPath,
              confidence: edge.confidence,
              weight: totalWeight,
              evidence: `symbol_edge:${edge.type}->${callerNode.name}`,
            });

            diffusionQueue.push({
              nodeId: callerNode.id,
              distance: current.distance + 1,
              weight: totalWeight,
            });
          }
        }

        // Backward diffusion: find dependencies (edges pointing FROM current node)
        const outgoingEdges = symbolEdges.filter((e) => e.from === current.nodeId);

        for (const edge of outgoingEdges) {
          const depNode = nodeById.get(edge.to);
          if (!depNode || visited.has(depNode.id)) continue;
          visited.add(depNode.id);

          const edgeWeight = calculateEdgeWeight(edge);
          const totalWeight = current.weight + edgeWeight;
          const depPath = depNode.path || params.primaryFile;

          if (current.distance + 1 <= maxDepth) {
            diffusionTargets.push({
              path: depPath,
              confidence: edge.confidence,
              weight: totalWeight,
              evidence: `symbol_edge:${edge.type}->${depNode.name}`,
            });

            diffusionQueue.push({
              nodeId: depNode.id,
              distance: current.distance + 1,
              weight: totalWeight,
            });
          }
        }
      }

      // Sort by weight (descending) and apply budget
      diffusionTargets.sort((a, b) => b.weight - a.weight);
      const limitedTargets =
        budget !== undefined ? diffusionTargets.slice(0, budget) : diffusionTargets;

      for (const dt of limitedTargets) {
        targets.push({
          path: dt.path,
          reason: 'symbol_definition',
          confidence: dt.confidence,
          evidence: dt.evidence,
        });
      }
    }
  }

  const dedupedTargets = dedupeTargets(targets);
  const primaryPath = normalizePath(params.primaryFile).replace(/^(\.\/|\/)+/, '');
  const totalCandidates = symbolNodes.filter((n) => {
    const nodePath = normalizePath(n.path || params.primaryFile).replace(/^(\.\/|\/)+/, '');
    return nodePath !== primaryPath && n.kind === 'reference';
  }).length;

  // Count only diffusion targets (excluding primary file)
  const selectedTargets = dedupedTargets.filter((t) => {
    const targetPath = normalizePath(t.path).replace(/^(\.\/|\/)+/, '');
    return t.reason === 'symbol_definition' && targetPath !== primaryPath;
  }).length;

  return {
    targets: dedupedTargets,
    candidates,
    matched,
    metrics: {
      totalCandidates,
      selectedTargets,
      budgetLimit: budget,
      sourceBreakdown: {
        fromDefinitionMap,
        fromSymbolMap,
      },
    },
  };
}

export class TargetResolver {
  private readonly churnPolicy: ChurnRankingPolicy;

  constructor(options?: { churnPolicy?: Partial<ChurnRankingPolicy> }) {
    const current = getChurnRankingPolicy();
    this.churnPolicy = {
      primaryBoost: options?.churnPolicy?.primaryBoost ?? current.primaryBoost,
      rerankWeight: options?.churnPolicy?.rerankWeight ?? current.rerankWeight,
      tieBreakWeight: options?.churnPolicy?.tieBreakWeight ?? current.tieBreakWeight,
    };
  }

  async resolve(params: {
    req: ContextRequest;
    includedFiles: string[];
    importRelatedFiles: string[];
    rgHitFiles: string[];
    definitionMap?: Record<string, CodeLocation>;
    symbolMap?: SymbolMap;
    diffusionDepth?: number;
    maxDiffusionTargets?: number;
    churnByFile?: Record<string, number>;
  }): Promise<{
    targets: ContextTarget[];
    strategy: 'explicit' | 'symbol' | 'diff' | 'default';
    diffusionMetrics?: DiffusionMetrics;
    targetSetSignature: string;
  }> {
    const {
      req,
      includedFiles,
      importRelatedFiles,
      rgHitFiles,
      definitionMap,
      symbolMap,
      diffusionDepth,
      maxDiffusionTargets,
      churnByFile,
    } = params;

    const runner = new MicroTaskRunner<TargetingDslContext>({
      debugLabel: 'context-targeting',
      maxRounds: 5,
      resolveData: async (ctx, key) => {
        if (key === 'explicitTargets') {
          const primary = buildPrimaryTarget(ctx.primaryFile);
          const explicit = buildExplicitTargets(req);
          return dedupeTargets([...primary, ...explicit]);
        }

        if (key === 'diffTargets') {
          const primary = buildPrimaryTarget(ctx.primaryFile);
          const diff = buildDiffTargets(includedFiles);
          return dedupeTargets([...primary, ...diff]);
        }

        if (key === 'symbolTargets') {
          if (!ctx.primaryFile) return [];
          const primary = buildPrimaryTarget(ctx.primaryFile);
          const res = buildSymbolTargets({
            primaryFile: ctx.primaryFile,
            instruction: ctx.instruction,
            definitionMap,
            symbolMap,
            diffusionDepth,
            maxDiffusionTargets,
          });
          ctx.data!.symbolMetrics = res.metrics;
          return dedupeTargets([...primary, ...res.targets]);
        }

        if (key === 'defaultTargets') {
          const primary = buildPrimaryTarget(ctx.primaryFile);
          const imports = buildImportNeighborTargets(importRelatedFiles, 3);
          const rg = buildRgHitTargets(rgHitFiles, 2);
          const combined = dedupeTargets([...primary, ...imports, ...rg]);
          if (combined.length > 0) return combined;
          if (!ctx.primaryFile) return [];
          return [
            {
              path: ctx.primaryFile,
              reason: 'fallback',
              confidence: 'low',
              evidence: 'no_signals',
            },
          ];
        }

        return [];
      },
      strategy: (engine: DecisionEngine<TargetingDslContext>) => {
        return engine
          .phase('Dependencies')
          .requireData(['explicitTargets', 'symbolTargets', 'diffTargets', 'defaultTargets'])
          .phase('Selection')
          .when(
            (c) =>
              ((c.data?.explicitTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'explicit_path',
              ),
            (p) => {
              p.addAction('SET_TARGETS', {
                strategy: 'explicit',
                targets: engine.ctx.data!.explicitTargets,
              });
            },
          )
          .when(
            (c) =>
              !((c.data?.explicitTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'explicit_path',
              ) &&
              ((c.data?.symbolTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'symbol_definition',
              ),
            (p) => {
              p.addAction('SET_TARGETS', {
                strategy: 'symbol',
                targets: engine.ctx.data!.symbolTargets,
              });
            },
          )
          .when(
            (c) =>
              !((c.data?.explicitTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'explicit_path',
              ) &&
              !((c.data?.symbolTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'symbol_definition',
              ) &&
              ((c.data?.diffTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'diff_included',
              ),
            (p) => {
              p.addAction('SET_TARGETS', {
                strategy: 'diff',
                targets: engine.ctx.data!.diffTargets,
              });
            },
          )
          .unless(
            (c) =>
              ((c.data?.explicitTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'explicit_path',
              ) ||
              ((c.data?.symbolTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'symbol_definition',
              ) ||
              ((c.data?.diffTargets as ContextTarget[] | undefined) || []).some(
                (t) => t.reason === 'diff_included',
              ),
            (p) => {
              p.addAction('SET_TARGETS', {
                strategy: 'default',
                targets: engine.ctx.data!.defaultTargets,
              });
            },
          );
      },
    });

    const ctx: TargetingDslContext = {
      repoPath: req.repoPath,
      primaryFile: req.primaryFile,
      instruction: req.instruction,
      data: {},
    };

    const result = await runner.decide(ctx);
    const action = result.plan.actions.find((a) => a.type === 'SET_TARGETS');
    const targets = (action?.params?.targets as ContextTarget[] | undefined) ?? [];
    const strategy =
      (action?.params?.strategy as 'explicit' | 'symbol' | 'diff' | 'default' | undefined) ??
      'default';
    const diffusionMetrics = ctx.data?.symbolMetrics as DiffusionMetrics | undefined;
    const targetsWithChurn = applyChurnWeights(
      targets,
      churnByFile,
      req.primaryFile,
      this.churnPolicy,
    );
    const targetSetSignature = createTargetSetSignature(targetsWithChurn);

    if (targetsWithChurn.length > 0) {
      getLogger().trace(
        `  [CONTEXT] TargetResolver selected ${targetsWithChurn.length} targets (strategy=${strategy})`,
      );
    }

    return { targets: targetsWithChurn, strategy, diffusionMetrics, targetSetSignature };
  }
}
