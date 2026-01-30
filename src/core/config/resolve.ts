import { ConfigError } from './errors.js';
import { tryLoadConfigFile } from './load.js';
import { getDefaultRepoConfigPath } from './paths.js';
import type { ApiKeySource, ConfigFileV1, ResolvedConfig, ResolvedLlmProvider } from './types.js';

function firstNonEmpty(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return v ? v : undefined;
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

function resolveBaseUrl(configBaseUrl?: string): string | undefined {
  return (
    firstNonEmpty(configBaseUrl) ||
    firstNonEmpty(process.env.S8P_BASE_URL) ||
    firstNonEmpty(process.env.SALMON_BASE_URL)
  );
}

function resolveModelId(configModelId?: string): string {
  return (
    firstNonEmpty(configModelId) ||
    firstNonEmpty(process.env.S8P_MODEL) ||
    firstNonEmpty(process.env.SALMON_MODEL) ||
    'gpt-4o'
  );
}

function resolveLlmFromConfig(raw?: ConfigFileV1): ResolvedLlmProvider {
  const llm = raw?.llm;
  const providerId = llm?.active || Object.keys(llm?.providers || {})[0] || 'default';
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
    verify: {
      command: raw?.verify?.command,
      timeoutMs: raw?.verify?.timeoutMs,
    },
    llm: resolveLlmFromConfig(raw),
  };
}
