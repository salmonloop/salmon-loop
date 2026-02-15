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
import type { ContextRequest, ContextResult, DiffScope } from './types.js';

export interface ContextServiceDeps {
  primaryTextGatherer: PrimaryTextGatherer;
  ripgrepGatherer: RipgrepGatherer;
  gitDiffGatherer: GitDiffGatherer;
  astGatherer: AstGatherer;
  assembler: PromptAssembler;
}

function defaultDeps(): ContextServiceDeps {
  return {
    primaryTextGatherer: new PrimaryTextGatherer(),
    ripgrepGatherer: new RipgrepGatherer(),
    gitDiffGatherer: new GitDiffGatherer(),
    astGatherer: new AstGatherer(),
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
    assertNotAborted(req.signal);
    const diffScope: DiffScope = req.diffScope ?? 'primary';

    logger.trace(`  [CONTEXT] Building context for repo: ${req.repoPath}`);
    logger.trace(`  [CONTEXT] File: ${req.primaryFile}, Instruction: ${req.instruction}`);

    const { primaryText } = await this.deps.primaryTextGatherer.gather(req);
    assertNotAborted(req.signal);

    const keywords = extractKeywords(req.instruction);
    const rgSnippets = await this.deps.ripgrepGatherer.searchMultipleKeywords(
      keywords,
      req.repoPath,
      req.signal,
    );
    assertNotAborted(req.signal);

    const { stagedDiff, unstagedDiff, gitDiff, includedFiles } =
      await this.deps.gitDiffGatherer.gather({
        ...req,
        diffScope,
      });
    assertNotAborted(req.signal);

    const { symbols, definitionMap, relatedFiles } = await this.deps.astGatherer.gather(
      primaryText,
      req,
    );
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
            stagedDiff: Boolean(ranked.stagedDiff) && !Boolean(budgeted.context.stagedDiff),
            unstagedDiff: Boolean(ranked.unstagedDiff) && !Boolean(budgeted.context.unstagedDiff),
            gitDiff: Boolean(ranked.gitDiff) && !Boolean(budgeted.context.gitDiff),
            untrackedDiff: Boolean(ranked.untrackedDiff) && !Boolean(budgeted.context.untrackedDiff),
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
    };
  }
}
