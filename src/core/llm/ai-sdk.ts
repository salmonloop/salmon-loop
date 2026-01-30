import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, jsonSchema, tool } from 'ai';

import { text } from '../../locales/index.js';
import { LIMITS } from '../limits.js';
import {
  extractUnifiedDiffFromLLMContent,
  formatContextForPrompt,
  parsePlanFromLLMContent,
} from '../llm-utils.js';
import { getPatchPrompt, getPlanPrompt } from '../prompt.js';
import type { ChatOptions, Context, LLM, LLMMessage, LLMRole, Plan } from '../types.js';

import { toLlmError, wrapPlanEmpty } from './errors.js';

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
    if (m.role === 'tool') {
      const toolCallId = m.tool_call_id || 'unknown';
      const toolName = m.name || 'unknown';
      const output = safeParseJsonObject(m.content);

      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId,
            toolName,
            output,
          },
        ],
      };
    }

    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      const parts: any[] = [];
      if (m.content) {
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

    return {
      role: m.role,
      content: m.content,
    };
  });
}

function toAiSdkToolSet(openAiTools: any[] | undefined): Record<string, any> | undefined {
  if (!Array.isArray(openAiTools) || openAiTools.length === 0) return undefined;

  const tools: Record<string, any> = {};
  for (const t of openAiTools) {
    const fn = t?.function;
    const name = fn?.name;
    if (!name || typeof name !== 'string') continue;

    tools[name] = tool({
      description: typeof fn?.description === 'string' ? fn.description : undefined,
      inputSchema: jsonSchema(fn?.parameters || { type: 'object', properties: {} }),
      // Tool execution is handled by Salmonloop's tool governance layer (policy/audit) separately.
      outputSchema: jsonSchema({ type: 'object', properties: {} }),
    });
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
        baseURL: cfg.baseUrl ?? process.env.S8P_BASE_URL ?? process.env.SALMON_BASE_URL,
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
      baseURL: cfg.baseUrl ?? process.env.S8P_BASE_URL ?? process.env.SALMON_BASE_URL ?? '',
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
      streaming: false,
    };
  }

  async chat(messages: LLMMessage[], options: ChatOptions = {}): Promise<LLMMessage> {
    const aiMessages = toAiSdkMessages(messages);
    const tools = toAiSdkToolSet(options.tools);

    const abortController = new AbortController();
    const timeoutMs = this.timeoutMs;
    const timeoutHandle =
      typeof timeoutMs === 'number' && timeoutMs > 0
        ? setTimeout(() => abortController.abort(), timeoutMs)
        : undefined;

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
        timeout: timeoutMs,
      });

      return {
        role: 'assistant' as LLMRole,
        content: result.text || '',
        tool_calls: toOpenAiToolCalls((result as any).toolCalls),
      };
    } catch (e) {
      throw toLlmError(e, 'ai-sdk');
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  async createPlan(context: Context, instruction: string, lastError?: string): Promise<Plan> {
    const prompt = await getPlanPrompt(
      formatContextForPrompt(context),
      instruction,
      LIMITS.maxFilesChanged,
      lastError,
    );

    const response = await this.chat([{ role: 'user', content: prompt }], {
      responseFormat: 'json_object',
    });

    const content = response.content;
    if (!content) {
      throw wrapPlanEmpty();
    }

    try {
      return parsePlanFromLLMContent(content);
    } catch (e) {
      throw new Error(text.llm.planParseFailed(content, String(e)));
    }
  }

  async createPatch(context: Context, plan: Plan, lastError?: string): Promise<string> {
    const planStr = JSON.stringify(plan, null, 2);
    const formattedContext = formatContextForPrompt(context);

    const prompt = await getPatchPrompt(
      planStr,
      formattedContext,
      LIMITS.maxFilesChanged,
      LIMITS.maxDiffLines,
      lastError,
    );

    const response = await this.chat([{ role: 'user', content: prompt }]);
    return extractUnifiedDiffFromLLMContent(response.content || '');
  }
}
