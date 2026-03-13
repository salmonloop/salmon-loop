import { redactConfigForPrint } from '../../../core/config/index.js';
import type { ResolvedConfig } from '../../../core/config/types.js';
import { getLogger } from '../../../core/facades/cli-observability.js';
import { resolveCliConfig } from '../../utils/resolve-cli-config.js';
import type { ResolvedAuditScope } from '../../utils/resolve-cli-config.js';

export interface ResolvedCliConfig {
  repoPath: string;
  verboseLevel?: import('../../../core/types/execution.js').VerboseLevel;
  outputFormat?: import('../../utils/output-format.js').OutputFormat;
  headlessOutput?: boolean;
  resolvedConfig: ResolvedConfig;
  auditScope: ResolvedAuditScope;
}

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
  const resolved = await resolveCliConfig({
    repoPath: params.repoPath,
    configPath: params.cliOptions.config,
    enableConfigFile: params.cliOptions.configFile !== false,
    auditScope: params.cliOptions.auditScope,
    verbose: params.cliOptions.verbose,
    outputFormat: params.cliOptions.outputFormat,
  });
  if (!resolved.ok) {
    getLogger().error(resolved.message);
    if (params.outputFormat === 'json') {
      params.writeJsonFailure({
        message: resolved.message,
        errorCode: resolved.errorCode,
        repoPath: params.repoPath,
      });
    }
    return { ok: false, exitCode: 1 };
  }

  if (params.cliOptions.printConfig) {
    const raw = resolved.resolvedConfig.raw || { version: 1 };
    const redacted = redactConfigForPrint(raw);
    process.stdout.write(JSON.stringify(redacted, null, 2) + '\n');
    return { ok: true, printedConfig: true };
  }

  return {
    ok: true,
    resolvedConfig: {
      repoPath: resolved.repoPath,
      verboseLevel: resolved.verboseLevel,
      outputFormat: resolved.outputFormat,
      headlessOutput: resolved.headlessOutput,
      resolvedConfig: resolved.resolvedConfig,
      auditScope: resolved.auditScope,
    },
  };
}
