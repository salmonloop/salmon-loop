import { Command } from 'commander';

import {
  createContextCacheStore,
  createDefaultPermissionGate,
  ContextService,
  getLogger,
  setChurnRankingPolicy,
} from '../../core/facades/cli-context.js';
import { text } from '../locales/index.js';
import { resolveCliConfig } from '../utils/resolve-cli-config.js';

export async function handleContextCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const configResult = await resolveCliConfig({
    repo: allOptions.repo,
    cwd: process.cwd(),
    configPath: allOptions.config,
    enableConfigFile: allOptions.configFile !== false,
    auditScope: allOptions.auditScope,
    logMode: allOptions.logMode,
  });
  if (!configResult.ok) {
    getLogger().error(configResult.message, true);
    process.exit(1);
  }
  const { resolvedConfig, repoPath } = configResult;

  if (options.file && options.selection) {
    getLogger().error(text.cli.fileSelectionConflict, true);
    process.exit(1);
  }

  if (!options.instruction) {
    getLogger().error(text.cli.instructionRequired, true);
    process.exit(1);
  }

  const rawDiffScope = String(options.diffScope || 'primary');
  if (rawDiffScope !== 'primary' && rawDiffScope !== 'ast_related') {
    getLogger().error(text.cli.contextInvalidDiffScope(rawDiffScope), true);
    process.exit(1);
  }
  const diffScope = rawDiffScope === 'ast_related' ? 'ast_related' : 'primary';

  let budgetChars: number | undefined;
  if (options.budgetChars !== undefined) {
    const parsed = Number(options.budgetChars);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      getLogger().error(text.cli.contextInvalidBudgetChars(String(options.budgetChars)), true);
      process.exit(1);
    }
    budgetChars = parsed;
  }

  setChurnRankingPolicy({
    primaryBoost: resolvedConfig.raw?.context?.churn?.weight?.primary,
    rerankWeight: resolvedConfig.raw?.context?.churn?.weight?.rerank,
    tieBreakWeight: resolvedConfig.raw?.context?.churn?.weight?.tiebreak,
  });

  const cacheConfig = await createContextCacheStore(repoPath, resolvedConfig.raw, {
    permissionGate: createDefaultPermissionGate({
      allowOutsideCacheRoot: Boolean((allOptions as any).allowOutsideCacheRoot),
      repoRoot: repoPath,
    }),
  });
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

  getLogger().success(text.cli.contextBuilt(result.meta.usedChars, result.meta.truncated));
  process.stdout.write(result.prompt.trimEnd() + '\n');
}
