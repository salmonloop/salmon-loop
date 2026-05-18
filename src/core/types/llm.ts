import type { SharedV3ProviderOptions } from '@ai-sdk/provider';

import type { Context } from './context.js';
import type { ExecutionPhase } from './execution.js';
import type { Plan } from './planning.js';

export const LLM_OUTPUT_KINDS = [
  'review',
  'assistant_message',
  'explore',
  'research',
  'plan',
  'patch',
] as const;
export type LlmOutputKind = (typeof LLM_OUTPUT_KINDS)[number];

export interface LlmOutputPolicy {
  kinds: LlmOutputKind[];
}

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export type PromptCacheMode = 'cache_safe_only' | 'strict_full_prompt';
export type PromptCacheEligibility =
  | 'eligible'
  | 'missing_context_hash'
  | 'empty_cache_safe_surface'
  | 'below_min_tokens';

export interface OpenAICachePolicyHint {
  mode: PromptCacheMode;
  eligibility: PromptCacheEligibility;
  namespace?: string;
  contextHash?: string;
  cacheSafeFingerprint?: string;
  lateInjectionFingerprint?: string;
}

export interface LLMProviderHints {
  openAICacheHint?: string;
  openAICachePolicy?: OpenAICachePolicyHint;
}

export interface LLMMessage {
  role: LLMRole;
  content: string;
  name?: string;
  /**
   * Provider-native hidden reasoning content that must be replayed for providers that require
   * full assistant-turn continuity after tool calls.
   */
  reasoning_content?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface LLMStreamChunk {
  role: LLMRole;
  /**
   * Where this chunk came from.
   *
   * - 'provider': surfaced from a provider stream (or a thin adapter)
   * - 'synthesized': generated locally (e.g., fallbacks)
   */
  source?: 'provider' | 'synthesized';
  /**
   * Text delta emitted by the provider. Consumers are responsible for concatenation.
   */
  contentDelta?: string;
  /**
   * Hidden reasoning delta emitted by the provider. This must not be rendered as user-visible text,
   * but may need to be replayed in subsequent provider requests.
   */
  reasoningDelta?: string;
  /**
   * Provider-native tool call deltas (optional, provider-dependent).
   */
  tool_calls?: any[];
  /**
   * Indicates the end of the stream.
   */
  done?: boolean;
  /**
   * Reason why the stream finished.
   */
  finishReason?: string;
  /**
   * Optional token usage surfaced by the provider on stream completion.
   */
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface LlmCapabilities {
  toolCalling?: boolean;
  responseFormatJsonObject?: boolean;
  streaming?: boolean;
}

export interface ChatOptions {
  /**
   * Optional execution phase hint for model routing.
   */
  phase?: ExecutionPhase;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object' | 'text';
  responseFormatJsonObjectSupported?: boolean;
  stop?: string[];
  /**
   * Provider-native tool definitions.
   *
   * - For OpenAI: [{ type: 'function', function: { name, description, parameters } }]
   * - For other providers: ignored unless supported.
   */
  tools?: any[];
  /**
   * Provider-native tool choice directive.
   *
   * - For OpenAI: 'auto' | 'none' | { type: 'function', function: { name } }
   */
  toolChoice?: any;
  /**
   * Raw SalmonLoop ToolSpec objects for advanced mapping.
   */
  toolSpecs?: import('../tools/types.js').ToolSpec[];
  /**
   * Provider-specific request hints assembled by the request envelope layer.
   */
  providerHints?: LLMProviderHints;
  /**
   * Raw provider options passed through to the AI SDK request.
   */
  providerOptions?: SharedV3ProviderOptions;
  /**
   * Signal to abort the request.
   */
  signal?: AbortSignal;
}

export interface LLM {
  /**
   * Basic chat completion for multi-turn interaction
   */
  chat(messages: LLMMessage[], options?: ChatOptions): Promise<LLMMessage>;

  /**
   * Optional streaming chat interface.
   *
   * This is a forward-compatible contract only; the Grizzco pipeline does not
   * depend on streaming yet.
   */
  chatStream?(messages: LLMMessage[], options?: ChatOptions): AsyncIterable<LLMStreamChunk>;

  /**
   * Optional capabilities for strategy orchestration.
   *
   * This keeps the Grizzco pipeline provider-agnostic while allowing deterministic
   * decisions (e.g., enabling tool calling) without relying on constructor names.
   */
  getCapabilities?(options?: { phase?: ExecutionPhase }): LlmCapabilities;

  /**
   * Optional model identifier for audit and telemetry.
   */
  getModelId?(): string;

  /**
   * High-level goal-oriented methods (internally use chat)
   */
  createPlan(
    context: Context,
    instruction: string,
    lastError?: string,
    signal?: AbortSignal,
  ): Promise<Plan>;
  createPatch(
    context: Context,
    plan: Plan,
    lastError?: string,
    signal?: AbortSignal,
  ): Promise<string>;
}
