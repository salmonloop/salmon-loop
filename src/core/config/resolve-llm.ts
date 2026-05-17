import { resolveBaseUrl } from '../llm/base-url.js';

import { ConfigError } from './errors.js';
import { firstProviderRef, resolveApiKey, resolveModelId } from './resolve-env.js';
import type { ConfigFileV1, LlmCapabilitiesConfigV1, ResolvedLlmProvider } from './types.js';

function mergeCapabilities(
  providerCapabilities?: LlmCapabilitiesConfigV1,
  modelCapabilities?: LlmCapabilitiesConfigV1,
): LlmCapabilitiesConfigV1 | undefined {
  if (!providerCapabilities && !modelCapabilities) return undefined;
  return {
    ...providerCapabilities,
    ...modelCapabilities,
  };
}

export function resolveLlmFromConfig(raw?: ConfigFileV1): ResolvedLlmProvider {
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
  const activeCapabilities = mergeCapabilities(provider.capabilities, activeProfile.capabilities);
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
              const capabilities = mergeCapabilities(
                phaseProvider.capabilities,
                profile.capabilities,
              );
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
                  capabilities,
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
    capabilities: activeCapabilities,
    routing: resolvedRouting,
  };
}
