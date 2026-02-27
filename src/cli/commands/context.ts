import { Command } from 'commander';

import { defaultPathAdapter } from '../../core/adapters/path/path-adapter.js';
import { resolveConfig } from '../../core/config/resolve.js';
import { createContextCacheStore } from '../../core/context/cache/store-factory.js';
import { ContextService } from '../../core/context/index.js';
import { setChurnRankingPolicy } from '../../core/context/targeting/churn-policy.js';
import { logger } from '../../core/observability/logger.js';
import { text } from '../locales/index.js';

export async function handleContextCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const repoPath = defaultPathAdapter.resolve(allOptions.repo || process.cwd());

  if (options.file && options.selection) {
    logger.error(text.cli.fileSelectionConflict, true);
    process.exit(1);
  }

  if (!options.instruction) {
    logger.error(text.cli.instructionRequired, true);
    process.exit(1);
  }

  const rawDiffScope = String(options.diffScope || 'primary');
  if (rawDiffScope !== 'primary' && rawDiffScope !== 'ast_related') {
    logger.error(text.cli.contextInvalidDiffScope(rawDiffScope), true);
    process.exit(1);
  }
  const diffScope = rawDiffScope === 'ast_related' ? 'ast_related' : 'primary';

  let budgetChars: number | undefined;
  if (options.budgetChars !== undefined) {
    const parsed = Number(options.budgetChars);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logger.error(text.cli.contextInvalidBudgetChars(String(options.budgetChars)), true);
      process.exit(1);
    }
    budgetChars = parsed;
  }

  const resolvedConfig = await resolveConfig({ repoRoot: repoPath });
  setChurnRankingPolicy({
    primaryBoost: resolvedConfig.raw?.context?.churn?.weight?.primary,
    rerankWeight: resolvedConfig.raw?.context?.churn?.weight?.rerank,
    tieBreakWeight: resolvedConfig.raw?.context?.churn?.weight?.tiebreak,
  });

  const cacheConfig = createContextCacheStore(repoPath, resolvedConfig.raw);
  const service = new ContextService(
    {},
    {
      cacheStore: cacheConfig.store,
      cacheMaxEntries: cacheConfig.maxEntries,
      cacheTtlMs: cacheConfig.ttlMs,
    },
  );
  const result = await service.build({
    instruction: options.instruction,
    repoPath,
    primaryFile: options.file,
    selection: options.selection,
    diffScope,
    budgetChars,
  });

  logger.success(text.cli.contextBuilt(result.meta.usedChars, result.meta.truncated));
  process.stdout.write(result.prompt.trimEnd() + '\n');
}
