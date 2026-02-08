import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, jsonSchema, streamText, tool } from 'ai';
import { z } from 'zod';

import { text } from '../../locales/index.js';
import { LIMITS } from '../limits.js';
import {
  extractUnifiedDiffFromLLMContent,
  formatContextForPrompt,
  parsePlanFromLLMContent,
} from '../llm-utils.js';
import { getPatchPrompt, getPlanPrompt } from '../prompt.js';
import type { ToolSpec } from '../tools/types.js';
import type {
  ChatOptions,
  Context,
  LLM,
  LLMMessage,
  LLMRole,
  LLMStreamChunk,
  Plan,
} from '../types.js';

import { resolveBaseUrl } from './base-url.js';
import { toLlmError, wrapPlanEmpty, sanitizeError } from './errors.js';
import { withRetry, withStreamRetry } from './retry-utils.js';
import { mapAiSdkStreamPartToChunk } from './stream-utils.js';

export type AiSdkClientPackage = '@ai-sdk/openai' | '@ai-sdk/openai-compatible';

export interface AiSdkLlmConfig {
  clientPackage: AiSdkClientPackage;
  providerName?: string;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function safeParseJsonObject(textValue: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(textValue);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // ignored
  }
  return {};
}

function toAiSdkMessages(messages: LLMMessage[]): any[] {
  return messages.map((m) => {
    // 1. Handle Tool Results
    if (m.role === 'tool') {
      const toolCallId = m.tool_call_id || 'unknown';
      const toolName = m.name || 'unknown';

      // Fix: AI SDK expects 'result' to be the actual return value, not necessarily an object.
      // If it's a string that looks like JSON, parse it. Otherwise use it as is.
      let result: any;
      try {
        result = JSON.parse(m.content);
      } catch {
        result = m.content;
      }

      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName,
            result,
            isError: result?.status === 'error',
          },
        ],
      };
    }

    // 2. Handle Assistant with Tool Calls
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const parts: any[] = [];
      // Fix: Ensure text content is not empty/undefined if provided
      if (m.content && typeof m.content === 'string') {
        parts.push({ type: 'text', text: m.content });
      }

      for (const call of m.tool_calls) {
        const toolCallId = call?.id || 'unknown';
        const toolName = call?.function?.name || call?.name || 'unknown';
        const rawArgs = call?.function?.arguments;
        const input =
          typeof rawArgs === 'string' && rawArgs.trim() ? safeParseJsonObject(rawArgs) : {};

        parts.push({
          type: 'tool-call',
          toolCallId,
          toolName,
          input,
        });
      }

      return {
        role: 'assistant',
        content: parts,
      };
    }

    // 3. Handle Standard Text Messages (User, System, simple Assistant)
    let content = m.content;
    if (content === undefined || content === null) {
      content = '';
    } else if (typeof content !== 'string') {
      // Ensure we don't pass objects/arrays that Zod might reject for a text field
      content = JSON.stringify(content);
    }

    return {
      role: m.role,
      content,
    };
  });
}

function toAiSdkToolSet(
  openAiTools: any[] | undefined,
  toolSpecs?: ToolSpec[],
): Record<string, any> | undefined {
  const tools: Record<string, any> = {};

  // 1. Priority: Direct mapping from ToolSpec (Preserves Zod Schema)
  if (Array.isArray(toolSpecs) && toolSpecs.length > 0) {
    for (const spec of toolSpecs) {
      // Best Practice: Use 'parameters' for input schema as per AI SDK spec.
      tools[spec.name] = tool({
        description: spec.description,
        parameters: spec.inputSchema,
        execute: async (args: any) => {
          // In SalmonLoop, execution is handled by the governance layer.
          // This is a placeholder to satisfy tool definitions if needed.
          return args;
        },
      } as any);

      // Force-inject outputSchema for the SalmonLoop governance layer.
      // Use z.any() as a safe fallback to ensure validation logic doesn't crash.
      (tools[spec.name] as any).outputSchema = spec.outputSchema || z.any();
    }
    return tools;
  }

  // 2. Fallback: Legacy OpenAI tool mapping
  if (!Array.isArray(openAiTools) || openAiTools.length === 0) return undefined;

  for (const t of openAiTools) {
    const fn = t?.function;
    const name = fn?.name;
    if (!name || typeof name !== 'string') continue;

    tools[name] = tool({
      description: typeof fn?.description === 'string' ? fn.description : undefined,
      parameters: jsonSchema(fn?.parameters || { type: 'object', properties: {} }),
    } as any);

    // Legacy tools always downgrade to z.any() output schema.
    (tools[name] as any).outputSchema = z.any();
  }

  return Object.keys(tools).length > 0 ? tools : undefined;
}

function toOpenAiToolCalls(toolCalls: any[] | undefined): any[] | undefined {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return undefined;

  // AI SDK tool calls: { type: 'tool-call', toolCallId, toolName, input }
  return toolCalls.map((c) => ({
    id: c?.toolCallId || c?.id || 'unknown',
    type: 'function',
    function: {
      name: c?.toolName || c?.name || 'unknown',
      arguments: JSON.stringify(c?.input ?? c?.args ?? {}),
    },
  }));
}

export class AiSdkLLM implements LLM {
  private model: any;
  private modelId: string;
  private timeoutMs?: number;

  constructor(private readonly cfg: AiSdkLlmConfig) {
    this.modelId = cfg.modelId || process.env.S8P_MODEL || process.env.SALMON_MODEL || 'gpt-4o';
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

    return withRetry(
      async () => {
        const abortController = new AbortController();

        // Handle internal timeout
        const timeoutHandle =
          typeof timeoutMs === 'number' && timeoutMs > 0
            ? setTimeout(() => abortController.abort(), timeoutMs)
            : undefined;

        // Chain with external signal if provided
        if (options.signal) {
          if (options.signal.aborted) {
            abortController.abort();
          } else {
            options.signal.addEventListener('abort', () => abortController.abort());
          }
        }

        try {
          const result = await generateText({
            model: this.model,
            messages: aiMessages,
            tools,
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
            stopSequences: options.stop,
            toolChoice: options.toolChoice === 'none' ? 'none' : tools ? 'auto' : undefined,
            abortSignal: abortController.signal,
          });

          return {
            role: 'assistant' as LLMRole,
            content: result.text || '',
            tool_calls: toOpenAiToolCalls((result as any).toolCalls),
          };
        } finally {
          if (timeoutHandle) clearTimeout(timeoutHandle);
        }
      },
      {
        maxRetries: 2,
        signal: options.signal, // Pass signal to retry logic
        retryableErrors: (err) => {
          const msg = String(err).toLowerCase();
          return (
            msg.includes('timeout') || msg.includes('rate limit') || msg.includes('overloaded')
          );
        },
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

    const streamFactory = async function* (this: AiSdkLLM) {
      const abortController = new AbortController();

      // Handle internal timeout
      const timeoutHandle =
        typeof timeoutMs === 'number' && timeoutMs > 0
          ? setTimeout(() => abortController.abort(), timeoutMs)
          : undefined;

      // Chain with external signal if provided
      if (options.signal) {
        if (options.signal.aborted) {
          abortController.abort();
        } else {
          options.signal.addEventListener('abort', () => abortController.abort());
        }
      }

      try {
        const result = await streamText({
          model: this.model,
          messages: aiMessages,
          tools,
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
          stopSequences: options.stop,
          toolChoice: options.toolChoice === 'none' ? 'none' : tools ? 'auto' : undefined,
          abortSignal: abortController.signal,
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
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }.bind(this);

    try {
      yield* withStreamRetry(streamFactory, {
        maxRetries: 2,
        signal: options.signal, // Pass signal to retry logic
        retryableErrors: (err) => {
          const msg = String(err).toLowerCase();
          return (
            msg.includes('timeout') || msg.includes('rate limit') || msg.includes('overloaded')
          );
        },
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

    const response = await this.chat([{ role: 'user', content: prompt }], {
      signal,
    });

    const content = response.content;
    if (!content) {
      throw wrapPlanEmpty();
    }

    try {
      return parsePlanFromLLMContent(content);
    } catch (e) {
      throw new Error(text.llm.planParseFailed(content, sanitizeError(e)));
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

    const response = await this.chat([{ role: 'user', content: prompt }], {
      signal,
    });
    return extractUnifiedDiffFromLLMContent(response.content || '');
  }
}
