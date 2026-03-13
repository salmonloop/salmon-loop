import { defaultPathAdapter } from '../../core/adapters/path/path-adapter.js';
import { ConfigError, normalizeUiLogMode, resolveConfig } from '../../core/config/index.js';
import type { ResolvedConfig } from '../../core/config/types.js';
import type { VerboseLevel } from '../../core/types/execution.js';
import { text } from '../locales/index.js';

import { resolveAuditScope } from './audit-scope.js';
import type { OutputFormat } from './output-format.js';
import { resolveOutputFormat } from './output-format.js';
import { resolveVerboseLevel } from './verbose-level.js';

export type ResolvedAuditScope = 'repo' | 'user';

export interface ResolvedCliCommonOptions {
  repoPath: string;
  verboseLevel?: VerboseLevel;
  outputFormat?: OutputFormat;
  headlessOutput?: boolean;
}

export type ResolveCliConfigResult =
  | {
      ok: true;
      repoPath: string;
      verboseLevel?: VerboseLevel;
      outputFormat?: OutputFormat;
      headlessOutput?: boolean;
      resolvedConfig: ResolvedConfig;
      auditScope: ResolvedAuditScope;
    }
  | {
      ok: false;
      message: string;
      errorCode?: string;
    };

export async function resolveCliConfig(params: {
  repoPath?: string;
  repo?: string;
  cwd?: string;
  configPath?: string;
  enableConfigFile?: boolean;
  auditScope?: string;
  verbose?: unknown;
  outputFormat?: string;
  logMode?: string;
}): Promise<ResolveCliConfigResult> {
  const common = resolveCliCommonOptions({
    repoPath: params.repoPath,
    repo: params.repo,
    cwd: params.cwd,
    verbose: params.verbose,
    outputFormat: params.outputFormat,
  });
  if (!common.ok) {
    return { ok: false, message: common.message };
  }

  const { repoPath, verboseLevel, outputFormat, headlessOutput } = common.options;

  let resolvedConfig: ResolvedConfig;
  try {
    resolvedConfig = await resolveConfig({
      repoRoot: repoPath,
      configFilePath: params.configPath,
      enableConfigFile: params.enableConfigFile !== false,
    });
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      return {
        ok: false,
        message: text.config.error(err.code || err.message, err.details),
        errorCode: err.code,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: text.config.loadFailed(msg) };
  }

  const auditScopeResolution = resolveAuditScope({
    cliValue: params.auditScope,
    configValue: resolvedConfig.observability.audit.scope,
  });
  if (!auditScopeResolution.ok) {
    return {
      ok: false,
      message: text.cli.invalidAuditScope(auditScopeResolution.invalid),
    };
  }

  if (params.logMode !== undefined) {
    const normalized = normalizeUiLogMode(params.logMode);
    if (!normalized) {
      return { ok: false, message: text.cli.logModeInvalid(String(params.logMode)) };
    }
    resolvedConfig = {
      ...resolvedConfig,
      ui: {
        ...resolvedConfig.ui,
        logMode: normalized,
      },
    };
  }

  return {
    ok: true,
    repoPath,
    verboseLevel,
    outputFormat,
    headlessOutput,
    resolvedConfig,
    auditScope: auditScopeResolution.value,
  };
}

export function resolveRepoPath(params: { repo?: string; cwd?: string }): string {
  return defaultPathAdapter.resolve(params.repo || params.cwd || process.cwd());
}

export function resolveCliCommonOptions(params: {
  repoPath?: string;
  repo?: string;
  cwd?: string;
  verbose?: unknown;
  outputFormat?: string;
}): { ok: true; options: ResolvedCliCommonOptions } | { ok: false; message: string } {
  const repoPath = params.repoPath ?? resolveRepoPath({ repo: params.repo, cwd: params.cwd });
  const verboseLevel = resolveVerboseLevel(params.verbose);
  let outputFormat: OutputFormat | undefined;
  let headlessOutput: boolean | undefined;

  if (params.outputFormat !== undefined) {
    const raw = String(params.outputFormat || '');
    const resolved = resolveOutputFormat(raw);
    if (!resolved) {
      return { ok: false, message: text.cli.invalidOutputFormat(raw) };
    }
    outputFormat = resolved;
    headlessOutput = resolved !== 'text';
  }

  return {
    ok: true,
    options: {
      repoPath,
      verboseLevel,
      outputFormat,
      headlessOutput,
    },
  };
}
