import type { JSONObject, SharedV3ProviderOptions } from '@ai-sdk/provider';
import type { ToolSet, generateText } from 'ai';

import type { OpenAICachePolicyHint } from '../../types/llm.js';
import type { ChatOptions } from '../../types/llm.js';

type GenerateTextParams = Parameters<typeof generateText>[0];
type GenerateToolChoice = GenerateTextParams extends { toolChoice?: infer T } ? T : never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JSONObject[string] {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((item) => isJsonValue(item));
}

function toJsonObject(value: unknown): JSONObject | undefined {
  if (!isRecord(value)) return undefined;

  const out: JSONObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isJsonValue(entry)) return undefined;
    out[key] = entry;
  }

  return out;
}

function buildOpenAICacheHintFromPolicy(
  policy: OpenAICachePolicyHint | undefined,
): string | undefined {
  if (!policy || policy.eligibility !== 'eligible') return undefined;
  if (!policy.contextHash || !policy.cacheSafeFingerprint) return undefined;

  const namespace =
    typeof policy.namespace === 'string' && policy.namespace.trim()
      ? policy.namespace
      : 'request-envelope';
  const components = [policy.contextHash, `stable:${policy.cacheSafeFingerprint}`];
  if (policy.mode === 'strict_full_prompt' && policy.lateInjectionFingerprint) {
    components.push(`late:${policy.lateInjectionFingerprint}`);
  }

  return `cache:${JSON.stringify({ namespace, components })}`;
}

function mergeProviderOptions(params: {
  providerOptions?: SharedV3ProviderOptions;
  providerHints?: {
    openAICacheHint?: string;
    openAICachePolicy?: OpenAICachePolicyHint;
  };
  providerOptionsKey: string;
}): SharedV3ProviderOptions | undefined {
  const merged: SharedV3ProviderOptions = isRecord(params.providerOptions)
    ? { ...params.providerOptions }
    : {};
  const cacheHint =
    params.providerHints?.openAICacheHint ??
    buildOpenAICacheHintFromPolicy(params.providerHints?.openAICachePolicy);

  if (cacheHint) {
    const existing = toJsonObject(merged[params.providerOptionsKey]) ?? {};

    if (typeof existing.user !== 'string' || !existing.user.trim()) {
      existing.user = cacheHint;
    }

    merged[params.providerOptionsKey] = existing;
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function buildAiSdkRequestParams(params: {
  model: any;
  messages: any[];
  tools?: ToolSet;
  options: ChatOptions;
  headers: Record<string, string>;
  abortSignal: AbortSignal;
  providerOptionsKey: string;
}) {
  return {
    model: params.model,
    messages: params.messages,
    tools: params.tools,
    temperature: params.options.temperature,
    maxOutputTokens:
      params.options.maxTokens != null ? Number(params.options.maxTokens) : undefined,
    stopSequences: params.options.stop,
    toolChoice: (params.options.toolChoice === 'none'
      ? 'none'
      : params.tools
        ? 'auto'
        : undefined) as GenerateToolChoice,
    providerOptions: mergeProviderOptions({
      providerOptions: params.options.providerOptions,
      providerHints: params.options.providerHints,
      providerOptionsKey: params.providerOptionsKey,
    }),
    headers: params.headers,
    abortSignal: params.abortSignal,
  };
}
