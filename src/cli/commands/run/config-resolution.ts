import { redactConfigForPrint, resolveConfig, ConfigError } from '../../../core/config/index.js';
import { logger } from '../../../core/observability/logger.js';
import { text } from '../../locales/index.js';

export type ResolvedCliConfig = Awaited<ReturnType<typeof resolveConfig>>;

export async function resolveRunConfig(params: {
  repoPath: string;
  cliOptions: any;
  outputFormat: 'text' | 'json' | 'stream-json';
  writeJsonFailure: (args: { message: string; errorCode?: string; repoPath?: string }) => void;
}): Promise<
  | { ok: true; resolvedConfig: ResolvedCliConfig }
  | { ok: false; exitCode: 1 }
  | { ok: true; printedConfig: true }
> {
  let resolvedConfig: ResolvedCliConfig;
  try {
    resolvedConfig = await resolveConfig({
      repoRoot: params.repoPath,
      configFilePath: params.cliOptions.config,
      enableConfigFile: params.cliOptions.configFile !== false,
    });
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      const msg = text.config.error(err.code || err.message, err.details);
      logger.error(msg);
      if (params.outputFormat === 'json') {
        params.writeJsonFailure({ message: msg, errorCode: err.code, repoPath: params.repoPath });
      }
      return { ok: false, exitCode: 1 };
    }

    const msg = err instanceof Error ? err.message : String(err);
    logger.error(text.config.loadFailed(msg));
    if (params.outputFormat === 'json') {
      params.writeJsonFailure({ message: text.config.loadFailed(msg), repoPath: params.repoPath });
    }
    return { ok: false, exitCode: 1 };
  }

  if (params.cliOptions.printConfig) {
    const raw = resolvedConfig.raw || { version: 1 };
    const redacted = redactConfigForPrint(raw);
    process.stdout.write(JSON.stringify(redacted, null, 2) + '\n');
    return { ok: true, printedConfig: true };
  }

  return { ok: true, resolvedConfig };
}
