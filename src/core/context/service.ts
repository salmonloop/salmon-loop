import { Pipeline } from '../grizzco/engine/pipeline/pipeline.js';
import {
  clearAuditContext,
  recordAuditEvent,
  setAuditContext,
} from '../observability/audit-trail.js';
import { logger } from '../observability/logger.js';
import type { Context } from '../types/index.js';

import { DefaultPromptAssembler } from './assembly/default-prompt-assembler.js';
import type { PromptAssembler } from './assembly/prompt-assembler.js';
import { applySmartCompression } from './compression/smart-compress.js';
import { AstGatherer } from './gatherers/ast-gatherer.js';
import { GitDiffGatherer } from './gatherers/git-diff-gatherer.js';
import { PrimaryTextGatherer } from './gatherers/primary-text-gatherer.js';
import { RipgrepGatherer } from './gatherers/ripgrep-gatherer.js';
import { extractKeywords } from './keywords.js';
import { packUntilFull } from './policies/pack-until-full.js';
import { rankContextForRelevance } from './scoring/relevance.js';
import { TargetResolver } from './targeting/target-resolver.js';
import type { ContextRequest, ContextResult, DiffScope } from './types.js';

export interface ContextServiceDeps {
  primaryTextGatherer: PrimaryTextGatherer;
  ripgrepGatherer: RipgrepGatherer;
  gitDiffGatherer: GitDiffGatherer;
  astGatherer: AstGatherer;
  targetResolver: TargetResolver;
  assembler: PromptAssembler;
}

function defaultDeps(): ContextServiceDeps {
  return {
    primaryTextGatherer: new PrimaryTextGatherer(),
    ripgrepGatherer: new RipgrepGatherer(),
    gitDiffGatherer: new GitDiffGatherer(),
    astGatherer: new AstGatherer(),
    targetResolver: new TargetResolver(),
    assembler: new DefaultPromptAssembler(),
  };
}

function calculateUsedChars(context: Context): number {
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

function calculateSectionChars(context: Context) {
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

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('Operation cancelled by user');
  }
}

export class ContextService {
  private readonly deps: ContextServiceDeps;

  constructor(deps: Partial<ContextServiceDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  async build(req: ContextRequest): Promise<ContextResult> {
    const diffScope: DiffScope = req.diffScope ?? 'primary';

    logger.trace(`  [CONTEXT] Building context for repo: ${req.repoPath}`);
    logger.trace(`  [CONTEXT] File: ${req.primaryFile}, Instruction: ${req.instruction}`);

    const pipeline = Pipeline.of({ req, diffScope })
      .step('CONTEXT_PRIMARY', async ({ req, diffScope }) => {
        assertNotAborted(req.signal);
        const { primaryText } = await this.deps.primaryTextGatherer.gather(req);
        assertNotAborted(req.signal);
        return { req, diffScope, primaryText };
      })
      .step('CONTEXT_GATHER', async ({ req, diffScope, primaryText }) => {
        assertNotAborted(req.signal);
        const keywords = extractKeywords(req.instruction);
        recordAuditEvent(
          'context.keywords.extracted',
          { count: keywords.length, keywords: keywords.slice(0, 5) },
          { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_GATHER' },
        );

        const [rgSnippets, diffRes, astRes] = await Promise.all([
          this.deps.ripgrepGatherer.searchMultipleKeywords(keywords, req.repoPath, req.signal),
          this.deps.gitDiffGatherer.gather({ ...req, diffScope }),
          this.deps.astGatherer.gather(primaryText, req),
        ]);
        assertNotAborted(req.signal);

        recordAuditEvent(
          'context.gather.completed',
          {
            rgSnippets: rgSnippets.length,
            includedFiles: diffRes.includedFiles.length,
            importedFiles: astRes.relatedFiles.length,
            syntaxErrors: astRes.syntaxErrors?.length ?? 0,
            hasParseError: Boolean(astRes.parseError),
          },
          { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_GATHER' },
        );

        return {
          req,
          diffScope,
          primaryText,
          rgSnippets,
          diffRes,
          astRes,
        };
      })
      .step(
        'CONTEXT_TARGETS',
        async ({ req, diffScope, primaryText, rgSnippets, diffRes, astRes }) => {
          assertNotAborted(req.signal);
          const importRelatedFiles = (astRes.relatedFiles ?? []).map((f) => f.path);
          const rgHitFiles = Array.from(new Set((rgSnippets ?? []).map((s) => s.file)));

          const { targets } = await this.deps.targetResolver.resolve({
            req,
            includedFiles: diffRes.includedFiles,
            importRelatedFiles,
            rgHitFiles,
          });
          assertNotAborted(req.signal);

          recordAuditEvent(
            'context.targets.resolved',
            {
              strategyTargets: targets.map((t) => ({
                path: t.path,
                reason: t.reason,
                confidence: t.confidence,
              })),
            },
            { source: 'context', severity: 'low', scope: 'session', phase: 'CONTEXT_TARGETS' },
          );

          return {
            req,
            diffScope,
            primaryText,
            rgSnippets,
            targets,
            includedFiles: diffRes.includedFiles,
            stagedDiff: diffRes.stagedDiff,
            unstagedDiff: diffRes.unstagedDiff,
            gitDiff: diffRes.gitDiff,
            relatedFiles: astRes.relatedFiles,
            symbols: astRes.symbols,
            definitionMap: astRes.definitionMap,
            analysis: {
              ast: {
                languageId: astRes.languageId,
                syntaxErrors: astRes.syntaxErrors,
                parseError: astRes.parseError,
                notes: [
                  'Type mismatch, dead code, and potential bug detection are not available in this analysis layer.',
                ],
              },
            },
          };
        },
      )
      .step('CONTEXT_BUDGET', async (ctx) => {
        const {
          req,
          diffScope,
          primaryText,
          rgSnippets,
          targets,
          includedFiles,
          stagedDiff,
          unstagedDiff,
          gitDiff,
          relatedFiles,
          symbols,
          definitionMap,
          analysis,
        } = ctx;

        assertNotAborted(req.signal);
        const context: Context = {
          repoPath: req.repoPath,
          primaryFile: req.primaryFile,
          primaryText,
          relatedFiles,
          rgSnippets,
          gitDiff,
          stagedDiff,
          unstagedDiff,
          untrackedDiff: undefined,
          untrackedFiles: [],
          symbols,
          definitionMap,
          targets,
          analysis,
        };

        const compressed = applySmartCompression(context, { budgetChars: req.budgetChars });
        const ranked = rankContextForRelevance(compressed);
        const preBudgetSectionChars = calculateSectionChars(ranked);

        const budget = req.budgetChars;
        const budgeted = packUntilFull(ranked, budget);

        const assembled = this.deps.assembler.assemble(budgeted.context, req);
        const sectionChars = calculateSectionChars(budgeted.context);
        const droppedSections =
          budgeted.truncated && preBudgetSectionChars.diffs > 0
            ? {
                stagedDiff:
                  ranked.stagedDiff !== undefined && budgeted.context.stagedDiff === undefined,
                unstagedDiff:
                  ranked.unstagedDiff !== undefined && budgeted.context.unstagedDiff === undefined,
                gitDiff: ranked.gitDiff !== undefined && budgeted.context.gitDiff === undefined,
                untrackedDiff:
                  ranked.untrackedDiff !== undefined &&
                  budgeted.context.untrackedDiff === undefined,
              }
            : undefined;

        return {
          context: budgeted.context,
          prompt: assembled.prompt,
          meta: {
            usedChars: calculateUsedChars(budgeted.context),
            truncated: budgeted.truncated,
            diffScope,
            includedFiles,
            requestedBudgetChars: budget,
            preBudgetSectionChars,
            sectionChars,
            droppedSections,
            ...(assembled.meta || {}),
          },
        } satisfies ContextResult;
      });

    setAuditContext({ source: 'context', severity: 'low', scope: 'session' });
    try {
      const report = await pipeline.execute();
      if (!report.success) {
        throw report.error ?? new Error('Context pipeline failed');
      }
      return report.data as ContextResult;
    } finally {
      clearAuditContext();
    }
  }
}
