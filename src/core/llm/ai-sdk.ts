import { randomUUID } from 'crypto';

import type { Context } from '../types/context.js';
import type { ChatOptions, LLM, LLMMessage, LLMStreamChunk } from '../types/llm.js';
import type { Plan } from '../types/planning.js';

import { executeAiSdkChatRequest, executeAiSdkChatStreamRequest } from './ai-sdk/chat-executor.js';
import {
  HIGH_LEVEL_PHASE_SPECS,
  type HighLevelPhaseSpec,
} from './ai-sdk/high-level-phase-specs.js';
import { toAiSdkMessages, toAiSdkToolSet } from './ai-sdk/message-mapper.js';
import { withAuditObservationName } from './ai-sdk/observation-context.js';
import {
  createAiSdkChatModel,
  resolveAiSdkModelId,
  resolveAiSdkProviderOptionsKey,
} from './ai-sdk/provider-factory.js';
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

  getCapabilities(): {
    toolCalling?: boolean;
    responseFormatJsonObject?: boolean;
    streaming?: boolean;
  } {
    return {
      toolCalling: true,
      responseFormatJsonObject: true,
      streaming: true,
    };
  }

  async chat(messages: LLMMessage[], options: ChatOptions = {}): Promise<LLMMessage> {
    const aiMessages = toAiSdkMessages(messages);
    const tools = toAiSdkToolSet(options.tools, options.toolSpecs);
    return executeAiSdkChatRequest({
      model: this.model,
      modelId: this.modelId,
      providerOptionsKey: this.providerOptionsKey,
      timeoutMs: this.timeoutMs,
      langfuseEnabled: Boolean(this.cfg.langfuseEnabled),
      requestId: randomUUID(),
      messages: aiMessages,
      tools,
      options,
    });
  }

  async *chatStream(
    messages: LLMMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    const aiMessages = toAiSdkMessages(messages);
    const tools = toAiSdkToolSet(options.tools, options.toolSpecs);
    yield* executeAiSdkChatStreamRequest({
      model: this.model,
      modelId: this.modelId,
      providerOptionsKey: this.providerOptionsKey,
      timeoutMs: this.timeoutMs,
      langfuseEnabled: Boolean(this.cfg.langfuseEnabled),
      requestId: randomUUID(),
      messages: aiMessages,
      tools,
      options,
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

  private async runHighLevelPhase<TInput extends { context: Context; signal?: AbortSignal }, TOutput>(
    spec: HighLevelPhaseSpec<TInput, TOutput>,
    input: TInput,
  ): Promise<TOutput> {
    const contextPrompt = formatContextForPrompt(input.context);
    const userPrompt = await spec.buildPrompt({ ...input, contextPrompt });
    const attachments = spec.buildAttachments({ ...input, contextPrompt });
    const content = await this.executeHighLevelPrompt({
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
        signal: params.signal,
      }),
    );

    return response.content;
  }
}
