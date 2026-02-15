import type { BaseDslContext, DecisionEngine } from '../../grizzco/dsl/DecisionEngine.js';
import { MicroTaskRunner } from '../../grizzco/dsl/MicroTaskRunner.js';
import { logger } from '../../observability/logger.js';
import type { ContextTarget } from '../../types/index.js';
import { normalizePath } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

interface TargetingDslContext extends BaseDslContext {
  repoPath: string;
  primaryFile?: string;
  instruction: string;
  data?: Record<string, unknown>;
}

function dedupeTargets(targets: ContextTarget[]): ContextTarget[] {
  const seen = new Set<string>();
  const out: ContextTarget[] = [];
  for (const t of targets) {
    const key = normalizePath(t.path).replace(/^(\.\/|\/)+/, '');
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...t, path: key });
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

export class TargetResolver {
  async resolve(params: {
    req: ContextRequest;
    includedFiles: string[];
    importRelatedFiles: string[];
    rgHitFiles: string[];
  }): Promise<{ targets: ContextTarget[]; strategy: 'explicit' | 'diff' | 'default' }> {
    const { req, includedFiles, importRelatedFiles, rgHitFiles } = params;

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
          .requireData(['explicitTargets', 'diffTargets', 'defaultTargets'])
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
      (action?.params?.strategy as 'explicit' | 'diff' | 'default' | undefined) ?? 'default';

    if (targets.length > 0) {
      logger.trace(
        `  [CONTEXT] TargetResolver selected ${targets.length} targets (strategy=${strategy})`,
      );
    }

    return { targets, strategy };
  }
}
