import { randomUUID } from 'crypto';

import type { Context } from '../types/context.js';
import type {
  ChatOptions,
  LLM,
  LlmCapabilities,
  LLMMessage,
  LLMStreamChunk,
} from '../types/llm.js';
import type { Plan } from '../types/planning.js';

import { executeAiSdkChatRequest, executeAiSdkChatStreamRequest } from './ai-sdk/chat-executor.js';
import {
  HIGH_LEVEL_PHASE_SPECS,
  type HighLevelPhaseName,
  type HighLevelPhaseSpec,
} from './ai-sdk/high-level-phase-specs.js';
import { toAiSdkMessages, toAiSdkToolSet } from './ai-sdk/message-mapper.js';
import { withAuditObservationName } from './ai-sdk/observation-context.js';
import {
  createAiSdkChatModel,
  resolveAiSdkModelId,
  resolveAiSdkProviderOptionsKey,
} from './ai-sdk/provider-factory.js';
import { repairToJsonObject } from './contracts/repair.js';
import type { RequestAttachment } from './request-envelope.js';
import { buildSharedRequestEnvelope } from './shared-request-assembly.js';
import { formatContextForPrompt } from './utils.js';

export type AiSdkClientPackage = '@ai-sdk/openai' | '@ai-sdk/openai-compatible';

export interface AiSdkLlmConfig {
  clientPackage: AiSdkClientPackage;
  providerName?: string;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  langfuseEnabled?: boolean;
  capabilities?: LlmCapabilities;
}

export class AiSdkLLM implements LLM {
  private model: any;
  private modelId: string;
  private providerOptionsKey: string;
  private timeoutMs?: number;

  constructor(private readonly cfg: AiSdkLlmConfig) {
    this.modelId = resolveAiSdkModelId(cfg.modelId);
    this.providerOptionsKey = resolveAiSdkProviderOptionsKey(cfg);
    this.timeoutMs = cfg.timeoutMs;
    this.model = createAiSdkChatModel(cfg, this.modelId);
  }

  getModelId(): string {
    return this.modelId;
  }

  getCapabilities(_options?: { phase?: ChatOptions['phase'] }): LlmCapabilities {
    return {
      toolCalling: true,
      responseFormatJsonObject: true,
      streaming: true,
      ...this.cfg.capabilities,
    };
  }

  private applyCapabilityOptions(options: ChatOptions = {}): ChatOptions {
    const capabilities = this.getCapabilities({ phase: options.phase });
    const requestOptions: ChatOptions = {
      ...options,
      responseFormatJsonObjectSupported: capabilities.responseFormatJsonObject !== false,
    };

    if (capabilities.toolCalling === false) {
      requestOptions.tools = undefined;
      requestOptions.toolSpecs = undefined;
      requestOptions.toolChoice = 'none';
    }

    return requestOptions;
  }

  private async *chatStreamFromChat(
    messages: LLMMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    const response = await this.chat(messages, options);
    if (response.reasoning_content) {
      yield {
        role: 'assistant',
        source: 'synthesized',
        reasoningDelta: response.reasoning_content,
      };
    }
    if (response.content) {
      yield { role: 'assistant', source: 'synthesized', contentDelta: response.content };
    }
    if (Array.isArray(response.tool_calls) && response.tool_calls.length > 0) {
      yield { role: 'assistant', source: 'synthesized', tool_calls: response.tool_calls };
    }
    yield { role: 'assistant', source: 'synthesized', done: true, finishReason: 'stop' };
  }

  async chat(messages: LLMMessage[], options: ChatOptions = {}): Promise<LLMMessage> {
    const aiMessages = toAiSdkMessages(messages);
    const requestOptions = this.applyCapabilityOptions(options);
    const tools = toAiSdkToolSet(requestOptions.tools, requestOptions.toolSpecs);
    return executeAiSdkChatRequest({
      model: this.model,
      modelId: this.modelId,
      providerOptionsKey: this.providerOptionsKey,
      timeoutMs: this.timeoutMs,
      langfuseEnabled: Boolean(this.cfg.langfuseEnabled),
      requestId: randomUUID(),
      messages: aiMessages,
      tools,
      options: requestOptions,
    });
  }

  async *chatStream(
    messages: LLMMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    const requestOptions = this.applyCapabilityOptions(options);
    const capabilities = this.getCapabilities({ phase: requestOptions.phase });
    if (capabilities.streaming === false) {
      yield* this.chatStreamFromChat(messages, requestOptions);
      return;
    }

    const aiMessages = toAiSdkMessages(messages);
    const tools = toAiSdkToolSet(requestOptions.tools, requestOptions.toolSpecs);
    yield* executeAiSdkChatStreamRequest({
      model: this.model,
      modelId: this.modelId,
      providerOptionsKey: this.providerOptionsKey,
      timeoutMs: this.timeoutMs,
      langfuseEnabled: Boolean(this.cfg.langfuseEnabled),
      requestId: randomUUID(),
      messages: aiMessages,
      tools,
      options: requestOptions,
    });
  }

  /**
   * Explicit tool-aware streaming method for the pipeline.
   * This surfaces text deltas and tool calls as they arrive.
   */
  async *chatWithToolsStreaming(
    messages: LLMMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    // Current pipeline implementation expects chatStream to handle basic deltas.
    // This is a specialized version that ensures tool-call governance can be observed.
    yield* this.chatStream(messages, options);
  }

  async createPlan(
    context: Context,
    instruction: string,
    lastError?: string,
    signal?: AbortSignal,
  ): Promise<Plan> {
    return this.runHighLevelPhase(HIGH_LEVEL_PHASE_SPECS.plan, {
      context,
      instruction,
      lastError,
      signal,
    });
  }

  async createPatch(
    context: Context,
    plan: Plan,
    lastError?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const planStr = JSON.stringify(plan, null, 2);
    return this.runHighLevelPhase(HIGH_LEVEL_PHASE_SPECS.patch, {
      context,
      planStr,
      lastError,
      signal,
    });
  }

  private async runHighLevelPhase<
    TInput extends { context: Context; signal?: AbortSignal },
    TOutput,
  >(spec: HighLevelPhaseSpec<TInput, TOutput>, input: TInput): Promise<TOutput> {
    const contextPrompt = formatContextForPrompt(input.context);
    const userPrompt = await spec.buildPrompt({ ...input, contextPrompt });
    const attachments = spec.buildAttachments({ ...input, contextPrompt });
    const content = await this.executeHighLevelPrompt({
      phase: spec.name,
      defaultNamespace: spec.namespace,
      contextHash: input.context.contextHash,
      userPrompt,
      attachments,
      observationName: spec.observationName,
      signal: input.signal,
    });
    return spec.parseResult(content);
  }

  private async executeHighLevelPrompt(params: {
    phase: HighLevelPhaseName;
    defaultNamespace: string;
    contextHash?: string;
    userPrompt: string;
    attachments: RequestAttachment[];
    observationName: string;
    signal?: AbortSignal;
  }): Promise<string | undefined> {
    const sharedEnvelope = buildSharedRequestEnvelope({
      defaultNamespace: params.defaultNamespace,
      contextHash: params.contextHash,
      systemPrompt: '',
      userPrompt: params.userPrompt,
      attachments: params.attachments,
    });

    const response = await withAuditObservationName(params.observationName, async () =>
      this.chat(sharedEnvelope.baseMessages, {
        providerHints: sharedEnvelope.envelope.providerHints,
        responseFormat: params.phase === 'plan' ? 'json_object' : undefined,
        signal: params.signal,
      }),
    );

    if (params.phase !== 'plan') {
      return response.content;
    }

    try {
      HIGH_LEVEL_PHASE_SPECS.plan.parseResult(response.content);
      return response.content;
    } catch (error) {
      const repair = await withAuditObservationName('PLAN:plan-json-repair', async () =>
        repairToJsonObject({
          llm: this,
          baseMessages: sharedEnvelope.baseMessages,
          chatOptions: {
            providerHints: sharedEnvelope.envelope.providerHints,
            signal: params.signal,
          },
          badContent: response.content ?? '',
          reason: error instanceof Error ? error.message : String(error),
        }),
      );
      return repair.content;
    }
  }
}
