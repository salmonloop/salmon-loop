import { randomUUID } from 'crypto';

import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, streamText } from 'ai';

import { LIMITS } from '../config/limits.js';
import {
  getAuditContext,
  recordAuditEvent,
  setAuditContext,
} from '../observability/audit-trail.js';
import { getPatchPrompt, getPlanPrompt } from '../prompts/runtime.js';
import type { Context } from '../types/context.js';
import type { ChatOptions, LLM, LLMMessage, LLMRole, LLMStreamChunk } from '../types/llm.js';
import type { Plan } from '../types/planning.js';

import { buildLangfuseHeaders } from './ai-sdk/langfuse-headers.js';
import {
  extractUsageFromAiSdkResult,
  toAiSdkMessages,
  toAiSdkToolSet,
  toOpenAiToolCalls,
} from './ai-sdk/message-mapper.js';
import {
  createAbortRuntime,
  createAiSdkRetryLogger,
  isRetryableAiSdkError,
  recordAiSdkRequestError,
  recordAiSdkRequestSuccess,
} from './ai-sdk/request-runtime.js';
import { resolveBaseUrl } from './base-url.js';
import { toLlmError, wrapPlanEmpty, sanitizeError, LlmError } from './errors.js';
import { withRetry, withStreamRetry } from './retry-utils.js';
import { mapAiSdkStreamPartToChunk } from './stream-utils.js';
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
    this.modelId = cfg.modelId || process.env.SALMONLOOP_MODEL || process.env.S8P_MODEL || 'gpt-4o';
    this.timeoutMs = cfg.timeoutMs;

    if (cfg.clientPackage === '@ai-sdk/openai') {
      const provider = createOpenAI({
        apiKey: cfg.apiKey ?? process.env.SALMONLOOP_API_KEY ?? process.env.S8P_API_KEY,
        baseURL: resolveBaseUrl(cfg.baseUrl),
        headers: cfg.headers,
      });

      // Prefer the chat API to preserve the existing tool call loop semantics.
      this.model = provider.chat(this.modelId);
      return;
    }

    const headers: Record<string, string> = { ...(cfg.headers || {}) };
    const apiKey = cfg.apiKey ?? process.env.SALMONLOOP_API_KEY ?? process.env.S8P_API_KEY;
    if (apiKey && !headers.Authorization) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const provider = createOpenAICompatible({
      name: cfg.providerName || 'openai-compatible',
      baseURL: resolveBaseUrl(cfg.baseUrl) ?? '',
      headers,
    });

    this.model = provider.chatModel(this.modelId);
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

    return withRetry(
      async () => {
        attempt += 1;
        const startedAt = Date.now();
        const auditCtx = getAuditContext();
        const { signal: abortSignal, cleanup } = createAbortRuntime({
          timeoutMs,
          externalSignal: options.signal,
        });
        const langfuseHeaders = buildLangfuseHeaders(Boolean(this.cfg.langfuseEnabled), {
          runId: auditCtx.correlationId,
          phase: auditCtx.phase,
          observationName: auditCtx.observationName,
          observationId: `${requestId}-a${attempt}`,
          sessionId: auditCtx.sessionId,
          userId: auditCtx.userId,
        });
        const toolCount = tools ? Object.keys(tools).length : 0;

        try {
          const result = await generateText({
            model: this.model,
            messages: aiMessages,
            tools,
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
            stopSequences: options.stop,
            toolChoice: options.toolChoice === 'none' ? 'none' : tools ? 'auto' : undefined,
            headers: langfuseHeaders,
            abortSignal,
          });

          recordAiSdkRequestSuccess({
            requestId,
            modelId: this.modelId,
            attempt,
            startedAt,
            toolCount,
            streamed: false,
            auditCtx,
          });

          const usage = extractUsageFromAiSdkResult(result);
          if (usage) {
            recordAuditEvent('llm.usage', usage, {
              source: 'llm',
              severity: 'low',
              scope: 'session',
            });
          }

          return {
            role: 'assistant' as LLMRole,
            content: result.text || '',
            tool_calls: toOpenAiToolCalls((result as any).toolCalls),
          };
        } catch (e) {
          recordAiSdkRequestError({
            requestId,
            modelId: this.modelId,
            attempt,
            startedAt,
            toolCount,
            streamed: false,
            auditCtx,
            error: e,
          });
          throw e;
        } finally {
          cleanup();
        }
      },
      {
        maxRetries: 2,
        jitterRatio: 0.2,
        signal: options.signal, // Pass signal to retry logic
        retryableErrors: isRetryableAiSdkError,
        onRetry: createAiSdkRetryLogger({ modelId: this.modelId, streamed: false }),
      },
    ).catch((e) => {
      throw toLlmError(e, 'ai-sdk');
    });
  }

  async *chatStream(
    messages: LLMMessage[],
    options: ChatOptions = {},
  ): AsyncIterable<LLMStreamChunk> {
    const aiMessages = toAiSdkMessages(messages);
    const tools = toAiSdkToolSet(options.tools, options.toolSpecs);
    const timeoutMs = this.timeoutMs;
    const requestId = randomUUID();
    let attempt = 0;

    const streamFactory = async function* (this: AiSdkLLM) {
      attempt += 1;
      const startedAt = Date.now();
      const auditCtx = getAuditContext();
      const { signal: abortSignal, cleanup } = createAbortRuntime({
        timeoutMs,
        externalSignal: options.signal,
      });
      const langfuseHeaders = buildLangfuseHeaders(Boolean(this.cfg.langfuseEnabled), {
        runId: auditCtx.correlationId,
        phase: auditCtx.phase,
        observationName: auditCtx.observationName,
        observationId: `${requestId}-a${attempt}`,
        sessionId: auditCtx.sessionId,
        userId: auditCtx.userId,
      });
      const toolCount = tools ? Object.keys(tools).length : 0;

      try {
        const result = await streamText({
          model: this.model,
          messages: aiMessages,
          tools,
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
          stopSequences: options.stop,
          toolChoice: options.toolChoice === 'none' ? 'none' : tools ? 'auto' : undefined,
          headers: langfuseHeaders,
          abortSignal,
        });

        let doneEmitted = false;
        // Use fullStream to get errors and finish reasons explicitly
        for await (const part of (result as any).fullStream) {
          if (!part) continue;

          if (part.type === 'error') throw part.error;
          if (part.type === 'abort') throw new Error('Stream aborted');

          const chunk = mapAiSdkStreamPartToChunk(part);
          if (!chunk) continue;

          if (chunk.done) {
            doneEmitted = true;
          }
          yield chunk;
        }

        if (!doneEmitted) {
          yield { role: 'assistant' as LLMRole, done: true, finishReason: 'unknown' };
        }

        recordAiSdkRequestSuccess({
          requestId,
          modelId: this.modelId,
          attempt,
          startedAt,
          toolCount,
          streamed: true,
          auditCtx,
        });
      } catch (e) {
        recordAiSdkRequestError({
          requestId,
          modelId: this.modelId,
          attempt,
          startedAt,
          toolCount,
          streamed: true,
          auditCtx,
          error: e,
        });
        throw e;
      } finally {
        cleanup();
      }
    }.bind(this);

    try {
      yield* withStreamRetry(streamFactory, {
        maxRetries: 2,
        jitterRatio: 0.2,
        signal: options.signal, // Pass signal to retry logic
        retryableErrors: isRetryableAiSdkError,
        onRetry: createAiSdkRetryLogger({ modelId: this.modelId, streamed: true }),
      });
    } catch (e) {
      throw toLlmError(e, 'ai-sdk');
    }
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

    const prevObsName = getAuditContext().observationName;
    setAuditContext({ observationName: 'PLAN:plan-json' });
    const response = await this.chat([{ role: 'user', content: prompt }], { signal }).finally(
      () => {
        setAuditContext({ observationName: prevObsName });
      },
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

    const prevObsName = getAuditContext().observationName;
    setAuditContext({ observationName: 'PATCH:unified-diff' });
    const response = await this.chat([{ role: 'user', content: prompt }], { signal }).finally(
      () => {
        setAuditContext({ observationName: prevObsName });
      },
    );
    return extractUnifiedDiffFromLLMContent(response.content || '');
  }
}
