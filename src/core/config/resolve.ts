import { resolveLlmOutputPolicy } from '../llm/output-policy.js';
import type { RedactionConfig } from '../security/redaction.js';

import { tryLoadConfigFile } from './load.js';
import { getDefaultRepoConfigPath } from './paths.js';
import { firstNonEmpty, parseBoolEnv } from './resolve-env.js';
import { resolveLlmFromConfig } from './resolve-llm.js';
import type {
  AstValidationStrictness,
  ConfigFileV1,
  LangfuseObservabilityConfigV1,
  MarkdownRenderMode,
  MarkdownTheme,
  PermissionMode,
  ResolvedConfig,
  ToolAuthorizationConfig,
  UiLogMode,
  UiLogView,
} from './types.js';
import {
  DEFAULT_MARKDOWN_RENDER_MODE,
  DEFAULT_MARKDOWN_THEME,
  DEFAULT_UI_LOG_MODE,
  DEFAULT_UI_LOG_VIEW,
  normalizePermissionMode,
  normalizeUiLogMode,
  normalizeUiLogView,
} from './types.js';

export interface ResolveConfigOptions {
  repoRoot: string;
  configFilePath?: string;
  enableConfigFile?: boolean;
}

const DEFAULT_TOOL_AUTH: ToolAuthorizationConfig = {
  sessionTtlMs: 30 * 60 * 1000,
  autoAllowRisk: {
    low: true,
    medium: false,
    high: false,
  },
  nonInteractive: {
    strategy: 'deny',
  },
  allowlist: {
    repoFile: '.salmonloop/config/authorization.json',
    userFile: '~/.salmonloop/config/authorization-user.json',
    summary: {
      every: 100,
      minIntervalMs: 10 * 60 * 1000,
      failureMinIntervalMs: 60 * 1000,
      maxToolStats: 1000,
      maxPathStats: 2000,
    },
    matching: {
      denySideEffects: 'any',
      allowSideEffects: 'all',
    },
  },
};

const DEFAULT_AST_VALIDATION_STRICTNESS: AstValidationStrictness = 'lenient';

function resolveToolAuthorization(raw?: ConfigFileV1): ToolAuthorizationConfig {
  const config = raw?.toolAuthorization;
  return {
    sessionTtlMs: config?.sessionTtlMs ?? DEFAULT_TOOL_AUTH.sessionTtlMs,
    autoAllowRisk: {
      low: config?.autoAllowRisk?.low ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.low,
      medium: config?.autoAllowRisk?.medium ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.medium,
      high: config?.autoAllowRisk?.high ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.high,
    },
    nonInteractive: {
      strategy:
        config?.nonInteractive?.strategy ?? DEFAULT_TOOL_AUTH.nonInteractive?.strategy ?? 'deny',
      command: config?.nonInteractive?.command,
      mcp: config?.nonInteractive?.mcp,
    },
    allowlist: {
      repoFile: config?.allowlist?.repoFile ?? DEFAULT_TOOL_AUTH.allowlist?.repoFile,
      userFile: config?.allowlist?.userFile ?? DEFAULT_TOOL_AUTH.allowlist?.userFile,
      summary: {
        every: config?.allowlist?.summary?.every ?? DEFAULT_TOOL_AUTH.allowlist?.summary?.every,
        minIntervalMs:
          config?.allowlist?.summary?.minIntervalMs ??
          DEFAULT_TOOL_AUTH.allowlist?.summary?.minIntervalMs,
        failureMinIntervalMs:
          config?.allowlist?.summary?.failureMinIntervalMs ??
          DEFAULT_TOOL_AUTH.allowlist?.summary?.failureMinIntervalMs,
        maxToolStats:
          config?.allowlist?.summary?.maxToolStats ??
          DEFAULT_TOOL_AUTH.allowlist?.summary?.maxToolStats,
        maxPathStats:
          config?.allowlist?.summary?.maxPathStats ??
          DEFAULT_TOOL_AUTH.allowlist?.summary?.maxPathStats,
      },
      matching: {
        denySideEffects:
          config?.allowlist?.matching?.denySideEffects ??
          DEFAULT_TOOL_AUTH.allowlist?.matching?.denySideEffects,
        allowSideEffects:
          config?.allowlist?.matching?.allowSideEffects ??
          DEFAULT_TOOL_AUTH.allowlist?.matching?.allowSideEffects,
      },
    },
  };
}

function resolveMarkdownTheme(raw?: ConfigFileV1): MarkdownTheme {
  return raw?.output?.markdown?.theme ?? DEFAULT_MARKDOWN_THEME;
}

function resolveMarkdownRenderMode(raw?: ConfigFileV1): MarkdownRenderMode {
  return raw?.output?.markdown?.mode ?? DEFAULT_MARKDOWN_RENDER_MODE;
}

function resolveUiLogView(raw: ConfigFileV1 | undefined, mode: UiLogMode): UiLogView {
  const env =
    normalizeUiLogView(process.env.SALMONLOOP_UI_LOG_VIEW) ??
    normalizeUiLogView(process.env.SALMONLOOP_UI_LOG) ??
    normalizeUiLogView(process.env.SALMONLOOP_UI_DENSITY);
  if (env) return env;

  const cfg = normalizeUiLogView(raw?.ui?.log?.view);
  if (cfg) return cfg;

  if (mode === 'quiet') return 'compact';
  if (mode === 'debug') return 'full';
  return DEFAULT_UI_LOG_VIEW;
}

function resolveUiLogMode(raw?: ConfigFileV1): UiLogMode {
  const env =
    normalizeUiLogMode(process.env.SALMONLOOP_UI_LOG_MODE) ??
    normalizeUiLogMode(process.env.SALMONLOOP_UI_MODE);
  if (env) return env;

  const cfg = normalizeUiLogMode(raw?.ui?.log?.mode);
  return cfg ?? DEFAULT_UI_LOG_MODE;
}

function resolvePermissionMode(raw?: ConfigFileV1): PermissionMode {
  const cfg = normalizePermissionMode(raw?.mode);
  return cfg ?? 'interactive';
}

function resolveLangfuseObservability(raw?: ConfigFileV1): {
  enabled: boolean;
  outcome: boolean;
  endpoint?: string;
  sessionId?: string;
  userId?: string;
} {
  const cfg: LangfuseObservabilityConfigV1 | undefined = raw?.observability?.langfuse;

  const enabled = parseBoolEnv(process.env.SALMONLOOP_LANGFUSE) ?? cfg?.enabled ?? false;
  const outcome = parseBoolEnv(process.env.SALMONLOOP_LANGFUSE_OUTCOME) ?? cfg?.outcome ?? false;

  // Prefer explicit proxy base URL env override (backwards-compatible). This may be either:
  // - a root proxy URL (e.g. "https://api.s8p.io"), or
  // - a full /langfuse endpoint (e.g. "https://api.s8p.io/langfuse/").
  const endpoint =
    firstNonEmpty(process.env.SALMONLOOP_LANGFUSE_PROXY_URL) ?? firstNonEmpty(cfg?.endpoint);

  const sessionId =
    firstNonEmpty(process.env.SALMONLOOP_LANGFUSE_SESSION_ID) ?? firstNonEmpty(cfg?.sessionId);

  const userId =
    firstNonEmpty(process.env.SALMONLOOP_LANGFUSE_USER_ID) ?? firstNonEmpty(cfg?.userId);

  return { enabled, outcome, endpoint, sessionId, userId };
}

function resolveAuditBuffer(raw?: ConfigFileV1) {
  const cfg = raw?.observability?.audit?.buffer;
  return {
    maxEvents: cfg?.maxEvents ?? 10000,
    maxBytes: cfg?.maxBytes ?? 20 * 1024 * 1024,
    droppedWarn: cfg?.droppedWarn ?? 100,
  };
}

function resolveAuditScope(raw?: ConfigFileV1): 'repo' | 'user' {
  const scope = raw?.observability?.audit?.scope;
  return scope === 'user' ? 'user' : 'repo';
}

function resolveRedactionConfig(raw?: ConfigFileV1): RedactionConfig {
  const cfg = raw?.security?.redaction;
  return {
    enabled: cfg?.enabled ?? true,
    mark: cfg?.mark ?? '[REDACTED]',
    maxDepth: cfg?.maxDepth ?? 6,
    keyAllowlist: cfg?.keyAllowlist,
    keyDenylist: cfg?.keyDenylist,
    patterns: cfg?.patterns,
    disableDefaults: cfg?.disableDefaults,
  };
}

function resolveAstValidationStrictness(raw?: ConfigFileV1): AstValidationStrictness {
  const strictness = raw?.astValidation?.strictness;
  if (strictness === 'strict' || strictness === 'lenient') return strictness;
  return DEFAULT_AST_VALIDATION_STRICTNESS;
}

function resolveUseTokenBudget(raw?: ConfigFileV1): boolean {
  const value = raw?.context?.useTokenBudget;
  return value !== false; // Default to true
}

function resolveDynamicBudget(raw?: ConfigFileV1) {
  const config = raw?.context?.dynamicBudget;
  return {
    enabled: config?.enabled ?? false,
    minBudget: config?.minBudget ?? 5000,
    maxBudget: config?.maxBudget ?? 100000,
    adjustmentStep: config?.adjustmentStep ?? 0.15,
    alerts: {
      truncationRateWarn: config?.alerts?.truncationRateWarn ?? 0.6,
      criticalDropRateWarn: config?.alerts?.criticalDropRateWarn ?? 0,
    },
  };
}

function resolveServerConfig(raw?: ConfigFileV1): ResolvedConfig['server'] {
  const serverRaw = raw?.server;
  if (!serverRaw) return undefined;
  const server: NonNullable<ResolvedConfig['server']> = {};
  if (serverRaw.a2a) {
    server.a2a = {
      host: serverRaw.a2a.host,
      port: serverRaw.a2a.port,
      tokens: serverRaw.a2a.tokens,
    };
  }
  if (serverRaw.sidecar) {
    server.sidecar = {
      socket: serverRaw.sidecar.socket,
      allowConditional: serverRaw.sidecar.allowConditional,
    };
  }
  if (serverRaw.acp) {
    server.acp = {
      sessionStore: {
        maxEntries: serverRaw.acp.sessionStore?.maxEntries,
        maxAgeMs: serverRaw.acp.sessionStore?.maxAgeMs,
        historyMaxEntries: serverRaw.acp.sessionStore?.historyMaxEntries,
        lockStaleMs: serverRaw.acp.sessionStore?.lockStaleMs,
        lockHeartbeatMs: serverRaw.acp.sessionStore?.lockHeartbeatMs,
      },
      checkpointManifest: {
        lockStaleMs: serverRaw.acp.checkpointManifest?.lockStaleMs,
        lockHeartbeatMs: serverRaw.acp.checkpointManifest?.lockHeartbeatMs,
      },
    };
  }
  return Object.keys(server).length > 0 ? server : undefined;
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
