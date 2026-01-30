/**
 * LLM implementations are swappable.
 * Core loop must NOT depend on provider-specific behavior.
 */
import OpenAI from 'openai';

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

export type { LLM };

export interface OpenAiClientConfig {
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
}

/**
 * @deprecated Use `AiSdkLLM` (AI SDK providers) instead.
 *
 * This legacy adapter is intentionally frozen:
 * - No new features (e.g., streaming) will be added.
 * - No new compatibility work will be done beyond critical fixes.
 */
export class OpenAILLM implements LLM {
  private client: OpenAI;
  private model: string;

  constructor(cfg: OpenAiClientConfig = {}) {
    this.client = new OpenAI({
      apiKey: cfg.apiKey ?? process.env.SALMONLOOP_API_KEY ?? process.env.S8P_API_KEY,
      baseURL: cfg.baseUrl ?? process.env.S8P_BASE_URL ?? process.env.SALMON_BASE_URL,
    });
    this.model = cfg.modelId ?? process.env.S8P_MODEL ?? process.env.SALMON_MODEL ?? 'gpt-4o';
  }

  getModelId(): string {
    return this.model;
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
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as any, // OpenAI compatible
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        response_format: options.responseFormat ? { type: options.responseFormat } : undefined,
        stop: options.stop,
        tools: options.tools as any,
        tool_choice: options.toolChoice as any,
      });

      const msg = response.choices[0].message;
      return {
        role: msg.role as LLMRole,
        content: msg.content || '',
        tool_calls: msg.tool_calls,
      };
    } catch (e) {
      throw toLlmError(e, 'openai');
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

export class StubLLM implements LLM {
  getCapabilities(): {
    toolCalling?: boolean;
    responseFormatJsonObject?: boolean;
    streaming?: boolean;
  } {
    return {
      toolCalling: false,
      responseFormatJsonObject: false,
      streaming: false,
    };
  }

  async chat(messages: LLMMessage[]): Promise<LLMMessage> {
    const lastMsg = messages[messages.length - 1];
    return {
      role: 'assistant',
      content: `Stub response for: ${lastMsg.content.substring(0, 50)}...`,
    };
  }

  async createPlan(_context: Context, instruction: string, _lastError?: string): Promise<Plan> {
    return {
      goal: `Implement functionality based on instruction "${instruction}"`,
      files: ['example.txt'],
      changes: ['Modify example file content'],
      verify: 'Check if changes are applied correctly',
    };
  }

  async createPatch(_context: Context, _plan: Plan, _lastError?: string): Promise<string> {
    return `diff --git a/example.txt b/example.txt
index 1234567..abcdefg 100644
--- a/example.txt
+++ b/example.txt
@@ -1,3 +1,3 @@
 -Hello
 +Hello World
  Test
 -End
 +End Test`;
  }
}

/**
 * A fake LLM for deterministic testing.
 */
export class FakeLLM implements LLM {
  constructor(
    private plans: Plan[],
    private patches: string[],
  ) {}

  private planIndex = 0;
  private patchIndex = 0;

  getCapabilities(): {
    toolCalling?: boolean;
    responseFormatJsonObject?: boolean;
    streaming?: boolean;
  } {
    return {
      toolCalling: false,
      responseFormatJsonObject: false,
      streaming: false,
    };
  }

  async chat(_messages: LLMMessage[]): Promise<LLMMessage> {
    return {
      role: 'assistant',
      content: 'Fake chat response',
    };
  }

  async createPlan(): Promise<Plan> {
    return this.plans[this.planIndex++] || this.plans[this.plans.length - 1];
  }

  async createPatch(): Promise<string> {
    return this.patches[this.patchIndex++] || this.patches[this.patches.length - 1];
  }
}
