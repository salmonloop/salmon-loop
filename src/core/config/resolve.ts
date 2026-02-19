import { resolveBaseUrl } from '../llm/base-url.js';
import { resolveLlmOutputPolicy } from '../llm/output-policy.js';

import { ConfigError } from './errors.js';
import { tryLoadConfigFile } from './load.js';
import { getDefaultRepoConfigPath } from './paths.js';
import type {
  ApiKeySource,
  ConfigFileV1,
  LangfuseObservabilityConfigV1,
  MarkdownRenderMode,
  MarkdownTheme,
  ResolvedConfig,
  ResolvedLlmProvider,
  ToolAuthorizationConfig,
} from './types.js';
import { DEFAULT_MARKDOWN_RENDER_MODE, DEFAULT_MARKDOWN_THEME } from './types.js';

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
    firstNonEmpty(process.env.SALMON_MODEL) ||
    'gpt-4o'
  );
}

function resolveLlmFromConfig(raw?: ConfigFileV1): ResolvedLlmProvider {
  const llm = raw?.llm;
  const providerKeys = Object.keys(llm?.providers || {});
  const providerId = llm?.active || (providerKeys.length > 0 ? providerKeys[0] : 'default');
  const provider = llm?.providers?.[providerId];
  if (llm?.active && llm.providers && !provider) {
    throw new ConfigError('CONFIG_LLM_ACTIVE_PROVIDER_NOT_FOUND', { provider: providerId });
  }

  if (provider?.models && Object.keys(provider.models).length > 0 && !provider.models.default) {
    throw new ConfigError('CONFIG_LLM_DEFAULT_MODEL_REQUIRED', { provider: providerId });
  }

  const apiKeyResolution = resolveApiKey(provider?.api?.apiKey);
  const baseUrl = resolveBaseUrl(provider?.api?.baseUrl);

  const models = provider?.models || {};
  const defaultModel = models.default?.id;
  const selectedModelId = resolveModelId(defaultModel);

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
      selectedModelSlot: 'default',
    },
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

function resolveToolAuthorization(raw?: ConfigFileV1): ToolAuthorizationConfig {
  const config = raw?.toolAuthorization;
  return {
    sessionTtlMs: config?.sessionTtlMs ?? DEFAULT_TOOL_AUTH.sessionTtlMs,
    autoAllowRisk: {
      low: config?.autoAllowRisk?.low ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.low,
      medium: config?.autoAllowRisk?.medium ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.medium,
      high: config?.autoAllowRisk?.high ?? DEFAULT_TOOL_AUTH.autoAllowRisk?.high,
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

function resolveLangfuseObservability(raw?: ConfigFileV1): {
  enabled: boolean;
  outcome: boolean;
  endpoint?: string;
} {
  const cfg: LangfuseObservabilityConfigV1 | undefined = raw?.observability?.langfuse;

  const enabled = parseBoolEnv(process.env.SALMONLOOP_LANGFUSE) ?? cfg?.enabled ?? false;
  const outcome = parseBoolEnv(process.env.SALMONLOOP_LANGFUSE_OUTCOME) ?? cfg?.outcome ?? false;

  // Prefer explicit proxy base URL env override (backwards-compatible). This may be either:
  // - a root proxy URL (e.g. "https://api.s8p.io"), or
  // - a full /langfuse endpoint (e.g. "https://api.s8p.io/langfuse/").
  const endpoint =
    firstNonEmpty(process.env.SALMONLOOP_LANGFUSE_PROXY_URL) ?? firstNonEmpty(cfg?.endpoint);

  return { enabled, outcome, endpoint };
}

export async function resolveConfig(opts: ResolveConfigOptions): Promise<ResolvedConfig> {
  const enabled = opts.enableConfigFile !== false;
  const path = opts.configFilePath || getDefaultRepoConfigPath(opts.repoRoot);
  const required = Boolean(opts.configFilePath);

  const loaded = await tryLoadConfigFile({
    repoRoot: opts.repoRoot,
    configPath: path,
    enabled,
    required,
  });
  const raw = loaded?.config;

  return {
    source: {
      enabled,
      path: loaded?.path || path,
      used: Boolean(loaded),
    },
    raw,
    observability: {
      langfuse: resolveLangfuseObservability(raw),
    },
    verify: {
      command: raw?.verify?.command,
      timeoutMs: raw?.verify?.timeoutMs,
    },
    llm: resolveLlmFromConfig(raw),
    llmOutput: resolveLlmOutputPolicy(raw?.output?.llm),
    markdownTheme: resolveMarkdownTheme(raw),
    markdownRenderMode: resolveMarkdownRenderMode(raw),
    toolAuthorization: resolveToolAuthorization(raw),
  };
}
