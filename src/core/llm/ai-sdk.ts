import { randomUUID } from 'crypto';

import { generateText, streamText } from 'ai';

import { LIMITS } from '../config/limits.js';
import { recordAuditEvent } from '../observability/audit-trail.js';
import { getPatchPrompt, getPlanPrompt } from '../prompts/runtime.js';
import type { Context } from '../types/context.js';
import type { ChatOptions, LLM, LLMMessage, LLMStreamChunk } from '../types/llm.js';
import type { Plan } from '../types/planning.js';

import {
  extractUsageFromAiSdkResult,
  toAiSdkMessages,
  toAiSdkToolSet,
} from './ai-sdk/message-mapper.js';
import { withAuditObservationName } from './ai-sdk/observation-context.js';
import { createAiSdkChatModel, resolveAiSdkModelId } from './ai-sdk/provider-factory.js';
import { buildAiSdkRequestParams } from './ai-sdk/request-params.js';
import {
  executeAiSdkAttempt,
  executeAiSdkStreamAttempt,
  prepareAiSdkAttempt,
  type PreparedAiSdkAttempt,
} from './ai-sdk/request-runtime.js';
import {
  mapAiSdkGenerateResultToMessage,
  mapAiSdkStreamResultToChunks,
} from './ai-sdk/result-mapper.js';
import { executeWithAiSdkRetry, executeWithAiSdkStreamRetry } from './ai-sdk/retry-executor.js';
import { wrapPlanEmpty, sanitizeError, LlmError } from './errors.js';
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
  private timeoutMs?: number;

  constructor(private readonly cfg: AiSdkLlmConfig) {
    this.modelId = resolveAiSdkModelId(cfg.modelId);
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

    const timeoutMs = this.timeoutMs;
    const requestId = randomUUID();
    let attempt = 0;

    return executeWithAiSdkRetry({
      signal: options.signal,
      modelId: this.modelId,
      streamed: false,
      run: async () => {
        attempt += 1;
        return executeAiSdkAttempt({
          requestId,
          modelId: this.modelId,
          attempt,
          streamed: false,
          prepare: () =>
            prepareAiSdkAttempt({
              timeoutMs,
              externalSignal: options.signal,
              langfuseEnabled: Boolean(this.cfg.langfuseEnabled),
              requestId,
              attempt,
              tools,
            }),
          run: async (attemptCtx) => {
            const result = await generateText(
              buildAiSdkRequestParams({
                model: this.model,
                messages: aiMessages,
                tools,
                options,
                headers: attemptCtx.langfuseHeaders,
                abortSignal: attemptCtx.abortSignal,
              }),
            );

            const usage = extractUsageFromAiSdkResult(result);
            if (usage) {
              recordAuditEvent('llm.usage', usage, {
                source: 'llm',
                severity: 'low',
                scope: 'session',
              });
            }

            return mapAiSdkGenerateResultToMessage(result as any);
          },
        });
      },
    });
  }

  async *chatStream(
    messages: LLMMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    const aiMessages = toAiSdkMessages(messages);
    const tools = toAiSdkToolSet(options.tools, options.toolSpecs);
    const model = this.model;
    const timeoutMs = this.timeoutMs;
    const requestId = randomUUID();
    let attempt = 0;

    const streamFactory = () => {
      attempt += 1;
      return executeAiSdkStreamAttempt({
        requestId,
        modelId: this.modelId,
        attempt,
        streamed: true,
        prepare: () =>
          prepareAiSdkAttempt({
            timeoutMs,
            externalSignal: options.signal,
            langfuseEnabled: Boolean(this.cfg.langfuseEnabled),
            requestId,
            attempt,
            tools,
          }),
        run: async function* (attemptCtx: PreparedAiSdkAttempt) {
          const result = await streamText(
            buildAiSdkRequestParams({
              model,
              messages: aiMessages,
              tools,
              options,
              headers: attemptCtx.langfuseHeaders,
              abortSignal: attemptCtx.abortSignal,
            }),
          );
          yield* mapAiSdkStreamResultToChunks((result as any).fullStream);
        },
      });
    };

    yield* executeWithAiSdkStreamRetry({
      run: streamFactory,
      signal: options.signal,
      modelId: this.modelId,
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
    const prompt = await getPlanPrompt(
      formatContextForPrompt(context),
      instruction,
      LIMITS.maxFilesChanged,
      lastError,
    );

    const response = await withAuditObservationName('PLAN:plan-json', async () =>
      this.chat([{ role: 'user', content: prompt }], { signal }),
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

    const response = await withAuditObservationName('PATCH:unified-diff', async () =>
      this.chat([{ role: 'user', content: prompt }], { signal }),
    );
    return extractUnifiedDiffFromLLMContent(response.content || '');
  }
}
