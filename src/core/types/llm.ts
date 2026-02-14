import type { Context } from './context.js';
import type { Plan } from './planning.js';

export const LLM_OUTPUT_KINDS = [
  'review',
  'assistant_message',
  'explore',
  'plan',
  'patch',
] as const;
export type LlmOutputKind = (typeof LLM_OUTPUT_KINDS)[number];

export interface LlmOutputPolicy {
  kinds: LlmOutputKind[];
}

export type LLMRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: LLMRole;
  content: string;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface LLMStreamChunk {
  role: LLMRole;
  /**
   * Text delta emitted by the provider. Consumers are responsible for concatenation.
   */
  contentDelta?: string;
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

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object' | 'text';
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
  getCapabilities?(): {
    toolCalling?: boolean;
    responseFormatJsonObject?: boolean;
    streaming?: boolean;
  };

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
