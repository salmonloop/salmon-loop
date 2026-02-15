import type { BaseDslContext, DecisionEngine } from '../../grizzco/dsl/DecisionEngine.js';
import { MicroTaskRunner } from '../../grizzco/dsl/MicroTaskRunner.js';
import { logger } from '../../observability/logger.js';
import type { CodeLocation, ContextTarget } from '../../types/index.js';
import { normalizePath } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

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

function mergeEvidence(existing: string | undefined, next: string | undefined): string | undefined {
  if (!existing) return next;
  if (!next) return existing;
  if (existing.includes(next)) return existing;
  return `${existing};${next}`;
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

function buildSymbolTargets(params: {
  primaryFile: string;
  instruction: string;
  definitionMap: Record<string, CodeLocation> | undefined;
}): { targets: ContextTarget[]; candidates: string[]; matched: string[] } {
  const candidates = extractSymbolCandidates(params.instruction);
  const map = params.definitionMap;
  if (!map || candidates.length === 0) {
    return { targets: [], candidates, matched: [] };
  }

  const matched: string[] = [];
  const targets: ContextTarget[] = [];
  for (const name of candidates) {
    const loc = map[name];
    if (!loc) continue;
    matched.push(name);
    targets.push({
      path: params.primaryFile,
      reason: 'symbol_definition',
      confidence: 'high',
      evidence: `symbol:${name}@${loc.start.line}:${loc.start.column}`,
    });
  }

  return { targets: dedupeTargets(targets), candidates, matched };
}

export class TargetResolver {
  async resolve(params: {
    req: ContextRequest;
    includedFiles: string[];
    importRelatedFiles: string[];
    rgHitFiles: string[];
    definitionMap?: Record<string, CodeLocation>;
  }): Promise<{ targets: ContextTarget[]; strategy: 'explicit' | 'symbol' | 'diff' | 'default' }> {
    const { req, includedFiles, importRelatedFiles, rgHitFiles, definitionMap } = params;

    const runner = new MicroTaskRunner<TargetingDslContext>({
      debugLabel: 'context-targeting',
      maxRounds: 5,
      resolveData: async (ctx, key) => {
        if (!ctx.primaryFile) {
          return [];
        }

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
          const primary = buildPrimaryTarget(ctx.primaryFile);
          const res = buildSymbolTargets({
            primaryFile: ctx.primaryFile,
            instruction: ctx.instruction,
            definitionMap,
          });
          return dedupeTargets([...primary, ...res.targets]);
        }

        if (key === 'defaultTargets') {
          const primary = buildPrimaryTarget(ctx.primaryFile);
          const imports = buildImportNeighborTargets(importRelatedFiles, 3);
          const rg = buildRgHitTargets(rgHitFiles, 2);
          const combined = dedupeTargets([...primary, ...imports, ...rg]);
          if (combined.length > 0) return combined;
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
          .require((c) => Boolean(c.primaryFile), 'No primary file provided')
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

    if (targets.length > 0) {
      logger.trace(
        `  [CONTEXT] TargetResolver selected ${targets.length} targets (strategy=${strategy})`,
      );
    }

    return { targets, strategy };
  }
}
