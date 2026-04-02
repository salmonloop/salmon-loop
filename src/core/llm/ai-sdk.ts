import { randomUUID } from 'crypto';

import { LIMITS } from '../config/limits.js';
import { getPatchPrompt, getPlanPrompt } from '../prompts/runtime.js';
import type { Context } from '../types/context.js';
import type { ChatOptions, LLM, LLMMessage, LLMStreamChunk } from '../types/llm.js';
import type { Plan } from '../types/planning.js';

import { executeAiSdkChatRequest, executeAiSdkChatStreamRequest } from './ai-sdk/chat-executor.js';
import { toAiSdkMessages, toAiSdkToolSet } from './ai-sdk/message-mapper.js';
import { withAuditObservationName } from './ai-sdk/observation-context.js';
import {
  createAiSdkChatModel,
  resolveAiSdkModelId,
  resolveAiSdkProviderOptionsKey,
} from './ai-sdk/provider-factory.js';
import { wrapPlanEmpty, sanitizeError, LlmError } from './errors.js';
import { buildRequestEnvelope, materializeRequestEnvelope } from './request-envelope.js';
import {
  extractUnifiedDiffFromLLMContent,
  formatContextForPrompt,
  parsePlanFromLLMContent,
} from './utils.js';

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
    const contextPrompt = formatContextForPrompt(context);
    const prompt = await getPlanPrompt(
      contextPrompt,
      instruction,
      LIMITS.maxFilesChanged,
      lastError,
    );
    const envelope = buildRequestEnvelope({
      system: '',
      user: prompt,
      attachments: [
        {
          key: 'context-prompt',
          kind: 'context',
          label: 'Context prompt',
          content: contextPrompt,
          cacheSafe: true,
        },
      ],
      cacheSafeSurface: {
        contextHash: context.contextHash,
        namespace: 'plan',
        mode: 'cache_safe_only',
      },
    });

    const response = await withAuditObservationName('PLAN:plan-json', async () =>
      this.chat(materializeRequestEnvelope(envelope), {
        providerHints: envelope.providerHints,
        signal,
      }),
    );

    const content = response.content;
    if (!content) {
      throw wrapPlanEmpty();
    }

    try {
      return parsePlanFromLLMContent(content);
    } catch (e) {
      throw new LlmError('LLM plan parsing failed', 'LLM_PLAN_INVALID_JSON', {
        causeMessage: sanitizeError(e),
      });
    }
  }

  async createPatch(
    context: Context,
    plan: Plan,
    lastError?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const planStr = JSON.stringify(plan, null, 2);
    const formattedContext = formatContextForPrompt(context);

    const prompt = await getPatchPrompt(
      planStr,
      formattedContext,
      LIMITS.maxFilesChanged,
      LIMITS.maxDiffLines,
      lastError,
    );
    const envelope = buildRequestEnvelope({
      system: '',
      user: prompt,
      attachments: [
        {
          key: 'context-prompt',
          kind: 'context',
          label: 'Context prompt',
          content: formattedContext,
          cacheSafe: true,
        },
        {
          key: 'plan-json',
          kind: 'plan',
          label: 'Plan JSON',
          content: planStr,
        },
      ],
      cacheSafeSurface: {
        contextHash: context.contextHash,
        namespace: 'patch',
        mode: 'cache_safe_only',
      },
    });

    const response = await withAuditObservationName('PATCH:unified-diff', async () =>
      this.chat(materializeRequestEnvelope(envelope), {
        providerHints: envelope.providerHints,
        signal,
      }),
    );
    return extractUnifiedDiffFromLLMContent(response.content || '');
  }
}
