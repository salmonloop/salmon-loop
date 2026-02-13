import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, jsonSchema, streamText, tool } from 'ai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

function formatOutputSchema(schema: z.ZodType<any> | undefined): string {
  if (!schema) return 'any (dynamic)';

  // If it's a simple primitive or has a description, use that
  const def = schema._def as any;
  if (def?.description) {
    return def.description;
  }

  try {
    const jsonSchemaObj = zodToJsonSchema(schema as any, {
      target: 'openApi3',
      $refStrategy: 'none',
    });

    // Remove common boilerplate to keep it concise for the LLM
    if (jsonSchemaObj && typeof jsonSchemaObj === 'object') {
      const { $schema: _$schema, ...cleanSchema } = jsonSchemaObj as any;
      return JSON.stringify(cleanSchema);
    }
  } catch {
    // Fallback
  }

  return 'complex object';
}

import { LIMITS } from '../config/limits.js';
import { getPatchPrompt, getPlanPrompt } from '../prompts/runtime.js';
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

function deepCloneJson(value: unknown, fallback: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return fallback;
    return JSON.parse(serialized);
  } catch {
    return fallback;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolApprovalResponse(value: unknown): value is {
  approvalId: string;
  approved: boolean;
  reason?: string;
} {
  return (
    isObjectRecord(value) &&
    typeof value.approvalId === 'string' &&
    typeof value.approved === 'boolean'
  );
}

function isToolResultOutput(value: unknown): boolean {
  if (!isObjectRecord(value) || typeof value.type !== 'string') return false;
  return ['text', 'json', 'execution-denied', 'error-text', 'error-json', 'content'].includes(
    value.type,
  );
}

function toAiSdkToolResultOutput(value: unknown): Record<string, unknown> {
  if (isToolResultOutput(value)) {
    return deepCloneJson(value, { type: 'json', value: null }) as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    return { type: 'text', value };
  }

  if (isObjectRecord(value) && typeof value.status === 'string') {
    const outputType = value.status === 'ok' ? 'json' : 'error-json';
    return {
      type: outputType,
      value: deepCloneJson(value, {}),
    };
  }

  return {
    type: 'json',
    value: deepCloneJson(value, null),
  };
}

function toAiSdkMessages(messages: LLMMessage[]): any[] {
  return messages.map((m) => {
    // 1. Handle Tool Results
    if (m.role === 'tool') {
      const toolCallId = m.tool_call_id || 'unknown';
      const toolName = m.name || 'unknown';

      let parsedContent: unknown;
      try {
        parsedContent = JSON.parse(m.content);
      } catch {
        parsedContent = m.content;
      }

      if (isToolApprovalResponse(parsedContent)) {
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-approval-response',
              approvalId: parsedContent.approvalId,
              approved: parsedContent.approved,
              ...(typeof parsedContent.reason === 'string' ? { reason: parsedContent.reason } : {}),
            },
          ],
        };
      }

      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName,
            output: toAiSdkToolResultOutput(parsedContent),
          },
        ],
      };
    }

    // 2. Handle Assistant with Tool Calls
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const parts: any[] = [];
      if (m.content && typeof m.content === 'string') {
        parts.push({ type: 'text', text: m.content });
      }

      for (const call of m.tool_calls) {
        const toolCallId = call?.id || 'unknown';
        const toolName = call?.function?.name || call?.name || 'unknown';
        const rawArgs = call?.function?.arguments;
        const input =
          typeof rawArgs === 'string'
            ? rawArgs.trim()
              ? safeParseJsonObject(rawArgs)
              : {}
            : (call?.input ?? call?.args ?? {});

        parts.push({
          type: 'tool-call',
          toolCallId,
          toolName,
          input: deepCloneJson(input, {}),
        });
      }

      return {
        role: 'assistant',
        content: parts,
      };
    }

    // 3. Handle Standard Text Messages
    let content = m.content;
    if (content === undefined || content === null) {
      content = '';
    }
    if (typeof content !== 'string') {
      content = JSON.stringify(content);
    }

    return {
      role: m.role as any,
      content: content as string,
    };
  });
}

function toAiSdkToolSet(
  openAiTools: any[] | undefined,
  toolSpecs?: ToolSpec[],
): Record<string, any> | undefined {
  const tools: Record<string, any> = {};

  // 1. Process ToolSpecs (Built-in tools with Zod schemas)
  if (Array.isArray(toolSpecs)) {
    for (const spec of toolSpecs) {
      // Augment description with output schema info
      const outputDesc = formatOutputSchema(spec.outputSchema);
      const description = `${spec.description}\n\nReturns: ${outputDesc}`;

      tools[spec.name] = tool({
        description,
        parameters: spec.inputSchema,
      } as any);

      // Attach outputSchema for the SalmonLoop governance layer validation.
      (tools[spec.name] as any).outputSchema = spec.outputSchema || z.any();
    }
  }

  // 2. Process OpenAI Tools (MCP / Dynamic tools)
  if (Array.isArray(openAiTools)) {
    for (const t of openAiTools) {
      const fn = t?.function;
      const name = fn?.name;
      if (!name || typeof name !== 'string' || tools[name]) continue;

      const rawDesc = typeof fn?.description === 'string' ? fn.description : '';
      const description = `${rawDesc}\n\nReturns: any (dynamic)`.trim();

      tools[name] = tool({
        description,
        parameters: jsonSchema(fn?.parameters || { type: 'object', properties: {} }),
      } as any);

      // Dynamic tools use z.any() for output validation.
      (tools[name] as any).outputSchema = z.any();
    }
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

    const response = await this.chat([{ role: 'user', content: prompt }], {
      signal,
    });
    return extractUnifiedDiffFromLLMContent(response.content || '');
  }
}
