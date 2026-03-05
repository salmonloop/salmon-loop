import { resolveLlmOutputPolicy } from '../llm/output-policy.js';

import { tryLoadConfigFile } from './load.js';
import { getDefaultRepoConfigPath } from './paths.js';
import { resolveLlmFromConfig } from './resolve-llm.js';
import { resolveAstValidationStrictness } from './resolvers/ast-validation.js';
import { resolveDynamicBudget, resolveUseTokenBudget } from './resolvers/context.js';
import {
  resolveAuditBuffer,
  resolveAuditScope,
  resolveLangfuseObservability,
} from './resolvers/observability.js';
import { resolveMarkdownRenderMode, resolveMarkdownTheme } from './resolvers/output.js';
import { resolvePermissionMode } from './resolvers/permission-mode.js';
import { resolveRedactionConfig } from './resolvers/security.js';
import { resolveServerConfig } from './resolvers/server.js';
import { resolveToolAuthorization } from './resolvers/tool-authorization.js';
import { resolveUiLogMode, resolveUiLogView } from './resolvers/ui.js';
import type { ResolvedConfig } from './types.js';

export interface ResolveConfigOptions {
  repoRoot: string;
  configFilePath?: string;
  enableConfigFile?: boolean;
}

export async function resolveConfig(opts: ResolveConfigOptions): Promise<ResolvedConfig> {
  const enabled = opts.enableConfigFile !== false;
  const path = opts.configFilePath;
  const required = Boolean(opts.configFilePath);

  const loaded = await tryLoadConfigFile({
    repoRoot: opts.repoRoot,
    configPath: path,
    enabled,
    required,
  });
  const raw = loaded?.config;
  const uiLogMode = resolveUiLogMode(raw);
  const permissionMode = resolvePermissionMode(raw);

  return {
    source: {
      enabled,
      path: loaded?.path || path || getDefaultRepoConfigPath(opts.repoRoot),
      used: Boolean(loaded),
    },
    raw,
    permissionMode,
    server: resolveServerConfig(raw),
    context: {
      useTokenBudget: resolveUseTokenBudget(raw),
      dynamicBudget: resolveDynamicBudget(raw),
    },
    observability: {
      langfuse: resolveLangfuseObservability(raw),
      audit: {
        scope: resolveAuditScope(raw),
        buffer: resolveAuditBuffer(raw),
      },
    },
    security: {
      redaction: resolveRedactionConfig(raw),
    },
    ui: {
      logMode: uiLogMode,
      logView: resolveUiLogView(raw, uiLogMode),
    },
    verify: {
      command: raw?.verify?.command,
      timeoutMs: raw?.verify?.timeoutMs,
    },
    astValidation: {
      strictness: resolveAstValidationStrictness(raw),
    },
    llm: resolveLlmFromConfig(raw),
    llmOutput: resolveLlmOutputPolicy(raw?.output?.llm),
    markdownTheme: resolveMarkdownTheme(raw),
    markdownRenderMode: resolveMarkdownRenderMode(raw),
    toolAuthorization: resolveToolAuthorization(raw),
  };
}
