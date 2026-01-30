import { extractKeywords } from '../keywords.js';
import { logger } from '../logger.js';
import type { Context } from '../types.js';

import { DefaultPromptAssembler } from './assembly/default-prompt-assembler.js';
import type { PromptAssembler } from './assembly/prompt-assembler.js';
import { AstGatherer } from './gatherers/ast-gatherer.js';
import { GitDiffGatherer } from './gatherers/git-diff-gatherer.js';
import { PrimaryTextGatherer } from './gatherers/primary-text-gatherer.js';
import { RipgrepGatherer } from './gatherers/ripgrep-gatherer.js';
import { packUntilFull } from './policies/pack-until-full.js';
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
  const snippets = context.rgSnippets.reduce((sum, s) => sum + (s.content?.length ?? 0), 0);
  const diff =
    (context.gitDiff?.length ?? 0) +
    (context.stagedDiff?.length ?? 0) +
    (context.unstagedDiff?.length ?? 0) +
    (context.untrackedDiff?.length ?? 0);
  return primary + snippets + diff;
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

    const { primaryText } = await this.deps.primaryTextGatherer.gather(req);

    const keywords = extractKeywords(req.instruction);
    const rgSnippets = await this.deps.ripgrepGatherer.searchMultipleKeywords(
      keywords,
      req.repoPath,
    );

    const { stagedDiff, unstagedDiff, gitDiff, includedFiles } =
      await this.deps.gitDiffGatherer.gather({
        ...req,
        diffScope,
      });

    const { symbols, definitionMap } = await this.deps.astGatherer.gather(
      primaryText,
      req.primaryFile,
    );

    const context: Context = {
      repoPath: req.repoPath,
      primaryFile: req.primaryFile,
      primaryText,
      rgSnippets,
      gitDiff,
      stagedDiff,
      unstagedDiff,
      untrackedDiff: undefined,
      untrackedFiles: [],
      symbols,
      definitionMap,
    };

    const budget = req.budgetChars;
    const budgeted = packUntilFull(context, budget);

    const assembled = this.deps.assembler.assemble(budgeted.context, req);

    return {
      context: budgeted.context,
      prompt: assembled.prompt,
      meta: {
        usedChars: calculateUsedChars(budgeted.context),
        truncated: budgeted.truncated,
        diffScope,
        includedFiles,
        ...(assembled.meta || {}),
      },
    };
  }
}
