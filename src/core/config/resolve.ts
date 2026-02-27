import { resolveBaseUrl } from '../llm/base-url.js';
import { resolveLlmOutputPolicy } from '../llm/output-policy.js';
import type { RedactionConfig } from '../security/redaction.js';

import { ConfigError } from './errors.js';
import { tryLoadConfigFile } from './load.js';
import { getDefaultRepoConfigPath } from './paths.js';
import type {
  AstValidationStrictness,
  ApiKeySource,
  ConfigFileV1,
  LangfuseObservabilityConfigV1,
  MarkdownRenderMode,
  MarkdownTheme,
  ResolvedConfig,
  ResolvedLlmProvider,
  ToolAuthorizationConfig,
  UiLogMode,
  UiLogView,
} from './types.js';
import {
  DEFAULT_MARKDOWN_RENDER_MODE,
  DEFAULT_MARKDOWN_THEME,
  DEFAULT_UI_LOG_MODE,
  DEFAULT_UI_LOG_VIEW,
  normalizeUiLogMode,
  normalizeUiLogView,
} from './types.js';

function firstNonEmpty(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return v ? v : undefined;
}

function parseBoolEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function resolveApiKey(inlineKey: string | null | undefined): {
  key?: string;
  source: ApiKeySource;
} {
  const inline = firstNonEmpty(inlineKey || undefined);
  if (inline) return { key: inline, source: 'inline' };

  const env = process.env.SALMONLOOP_API_KEY || process.env.S8P_API_KEY;
  const envKey = firstNonEmpty(env);
  if (envKey) return { key: envKey, source: 'env' };

  return { source: 'missing' };
}

function resolveModelId(configModelId?: string): string {
  return (
    firstNonEmpty(configModelId) ||
    firstNonEmpty(process.env.SALMONLOOP_MODEL) ||
    firstNonEmpty(process.env.S8P_MODEL) ||
    'gpt-4o'
  );
}

function firstProviderRef(value: string | string[] | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return firstNonEmpty(value);
  for (const v of value) {
    const found = firstNonEmpty(v);
    if (found) return found;
  }
  return undefined;
}

function resolveLlmFromConfig(raw?: ConfigFileV1): ResolvedLlmProvider {
  const llm = raw?.llm;
  const providers = llm?.providers || {};
  const modelProfiles = llm?.models || {};
  const hasConfiguredLlm = Boolean(llm);

  if (!hasConfiguredLlm) {
    return {
      id: 'default',
      type: 'openai-compatible',
      clientPackage: undefined,
      api: {
        baseUrl: resolveBaseUrl(undefined),
        timeoutMs: undefined,
        headers: undefined,
        apiKey: resolveApiKey(undefined).key,
        apiKeySource: resolveApiKey(undefined).source,
      },
      models: {
        selectedModelId: resolveModelId(undefined),
        selectedModelSlot: 'default',
      },
    };
  }

  if (Object.keys(providers).length === 0) {
    throw new ConfigError('CONFIG_LLM_PROVIDERS_REQUIRED');
  }
  if (Object.keys(modelProfiles).length === 0) {
    throw new ConfigError('CONFIG_LLM_MODELS_REQUIRED');
  }

  const activeModelSlot = llm?.activeModel || Object.keys(modelProfiles)[0];
  const activeProfile = modelProfiles[activeModelSlot];
  if (!activeProfile) {
    throw new ConfigError('CONFIG_LLM_ACTIVE_MODEL_NOT_FOUND', { model: activeModelSlot });
  }

  const providerId = firstProviderRef(activeProfile.provider);
  if (!providerId) {
    throw new ConfigError('CONFIG_LLM_MODEL_PROVIDER_INVALID', { model: activeModelSlot });
  }
  const provider = providers[providerId];
  if (!provider) {
    throw new ConfigError('CONFIG_LLM_MODEL_PROVIDER_NOT_FOUND', {
      model: activeModelSlot,
      provider: providerId,
    });
  }

  const apiKeyResolution = resolveApiKey(provider.api?.apiKey);
  const baseUrl = resolveBaseUrl(provider.api?.baseUrl);
  const selectedModelId = resolveModelId(activeProfile.id);
  const routing = llm?.routing;
  const phaseToProviderModel =
    routing?.phaseToModel && typeof routing.phaseToModel === 'object'
      ? Object.fromEntries(
          Object.entries(routing.phaseToModel)
            .map(([phase, profileSlot]) => {
              const profile = modelProfiles[profileSlot];
              if (!profile) {
                throw new ConfigError('CONFIG_LLM_PHASE_MODEL_NOT_FOUND', {
                  phase,
                  model: profileSlot,
                });
              }
              const phaseProviderId = firstProviderRef(profile.provider);
              if (!phaseProviderId) {
                throw new ConfigError('CONFIG_LLM_PHASE_PROVIDER_INVALID', {
                  phase,
                  model: profileSlot,
                });
              }
              const phaseProvider = providers[phaseProviderId];
              if (!phaseProvider) {
                throw new ConfigError('CONFIG_LLM_PHASE_PROVIDER_NOT_FOUND', {
                  phase,
                  model: profileSlot,
                  provider: phaseProviderId,
                });
              }
              const phaseKey = resolveApiKey(phaseProvider.api?.apiKey);
              return [
                phase,
                {
                  id: phaseProviderId,
                  type: phaseProvider.type || 'openai-compatible',
                  clientPackage: phaseProvider.client?.package,
                  api: {
                    baseUrl: resolveBaseUrl(phaseProvider.api?.baseUrl),
                    timeoutMs: phaseProvider.api?.timeoutMs,
                    headers: phaseProvider.api?.headers,
                    apiKey: phaseKey.key,
                    apiKeySource: phaseKey.source,
                  },
                  model: {
                    id: resolveModelId(profile.id),
                    slot: profileSlot,
                  },
                },
              ] as const;
            })
            .filter(Boolean),
        )
      : undefined;

  const resolvedRouting =
    routing &&
    (routing.fallbackProviders !== undefined ||
      routing.taskToModel !== undefined ||
      routing.phaseToModel !== undefined)
      ? {
          fallbackProviders: routing.fallbackProviders,
          taskToModel: routing.taskToModel,
          phaseToModel: routing.phaseToModel,
          phaseToProviderModel,
        }
      : undefined;

  return {
    id: providerId,
    type: provider?.type || 'openai-compatible',
    clientPackage: provider?.client?.package,
    api: {
      baseUrl,
      timeoutMs: provider?.api?.timeoutMs,
      headers: provider?.api?.headers,
      apiKey: apiKeyResolution.key,
      apiKeySource: apiKeyResolution.source,
    },
    models: {
      selectedModelId,
      selectedModelSlot: activeModelSlot,
    },
    routing: resolvedRouting,
  };
}

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
  };
}

function resolveRedactionConfig(raw?: ConfigFileV1): RedactionConfig {
  const cfg = raw?.security?.redaction;
  return {
    enabled: cfg?.enabled ?? true,
    mark: cfg?.mark ?? '[REDACTED]',
    maxDepth: cfg?.maxDepth ?? 6,
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

  return {
    source: {
      enabled,
      path: loaded?.path || path || getDefaultRepoConfigPath(opts.repoRoot),
      used: Boolean(loaded),
    },
    raw,
    context: {
      useTokenBudget: resolveUseTokenBudget(raw),
      dynamicBudget: resolveDynamicBudget(raw),
    },
    observability: {
      langfuse: resolveLangfuseObservability(raw),
      audit: {
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
