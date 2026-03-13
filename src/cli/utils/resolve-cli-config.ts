import { ConfigError, resolveConfig } from '../../core/config/index.js';
import type { ResolvedConfig } from '../../core/config/types.js';
import { text } from '../locales/index.js';

import { resolveAuditScope } from './audit-scope.js';

export type ResolvedAuditScope = 'repo' | 'user';

export type ResolveCliConfigResult =
  | {
      ok: true;
      resolvedConfig: ResolvedConfig;
      auditScope: ResolvedAuditScope;
    }
  | {
      ok: false;
      message: string;
      errorCode?: string;
    };

export async function resolveCliConfig(params: {
  repoPath: string;
  configPath?: string;
  enableConfigFile?: boolean;
  auditScope?: string;
}): Promise<ResolveCliConfigResult> {
  let resolvedConfig: ResolvedConfig;
  try {
    resolvedConfig = await resolveConfig({
      repoRoot: params.repoPath,
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

  return {
    ok: true,
    resolvedConfig,
    auditScope: auditScopeResolution.value,
  };
}
