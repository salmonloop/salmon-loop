/**
 * LLM implementations are swappable.
 * Core loop must NOT depend on provider-specific behavior.
 */
import OpenAI from 'openai';

import { text } from '../locales/index.js';

import { LIMITS } from './limits.js';
import { getPlanPrompt, getPatchPrompt } from './prompts.js';
import type { Context, Plan } from './types.js';

export interface LLM {
  createPlan(context: Context, instruction: string, lastError?: string): Promise<Plan>;
  createPatch(context: Context, plan: Plan, lastError?: string): Promise<string>;
}

export class OpenAILLM implements LLM {
  private client: OpenAI;
  private model: string;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.SALMON_API_KEY,
      baseURL: process.env.SALMON_BASE_URL,
    });
    this.model = process.env.SALMON_MODEL || 'gpt-4o';
  }

  async createPlan(context: Context, instruction: string, lastError?: string): Promise<Plan> {
    const prompt = getPlanPrompt(
      this.formatContext(context),
      instruction,
      LIMITS.maxFilesChanged,
      lastError,
    );

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error(text.llm.planEmpty);
    }

    try {
      const plan = this.extractJson(content) as Plan;
      // Validate plan structure
      if (
        !plan.goal ||
        !Array.isArray(plan.files) ||
        !Array.isArray(plan.changes) ||
        !plan.verify
      ) {
        throw new Error(text.llm.planInvalid);
      }
      return plan;
    } catch (e) {
      throw new Error(text.llm.planParseFailed(content, String(e)));
    }
  }

  async createPatch(context: Context, plan: Plan, lastError?: string): Promise<string> {
    const planStr = JSON.stringify(plan, null, 2);
    const prompt = getPatchPrompt(
      planStr,
      this.formatContext(context),
      LIMITS.maxFilesChanged,
      LIMITS.maxDiffLines,
      lastError,
    );

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error(text.llm.patchEmpty());
    }

    // Extract ONLY the last diff block (LLM may generate multiple attempts)
    const diffBlocks = content.match(/```(?:diff)?\s*\n(diff --git[\s\S]*?)\n```/g);
    if (diffBlocks && diffBlocks.length > 0) {
      // Take the LAST diff block (most recent version)
      const lastBlock = diffBlocks[diffBlocks.length - 1];
      return lastBlock.replace(/```(?:diff)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
    }

    // Fallback: extract raw diff without markdown
    const rawDiffMatch = content.match(/(diff --git[\s\S]*?)(?:\n\n[A-Z]|$)/);
    if (rawDiffMatch) {
      return rawDiffMatch[1].trim();
    }

    // Final fallback: original simple cleanup
    // Clean up markdown code blocks if present
    let cleanContent = content;
    // Remove ```diff or ``` at start
    cleanContent = cleanContent.replace(/^```(?:diff)?\s*\n/, '');
    // Remove ``` at end
    cleanContent = cleanContent.replace(/\n```\s*$/, '');

    return cleanContent.trim();
  }

  private extractJson(content: string): any {
    // 1. Try to find JSON block
    const jsonBlockMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1]);
      } catch (__e) {
        // Fallback to raw content if block is invalid
      }
    }

    // 2. Try to find anything that looks like a JSON object
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (__e) {
        // Fallback
      }
    }

    // 3. Final fallback: try parsing the whole content
    return JSON.parse(content);
  }

  private formatContext(context: Context): string {
    let result = `${text.context.workingDirectory}\n\n`;

    if (context.primaryText) {
      result += `${text.context.primaryFile(context.primaryFile || 'Selection')}\n`;
      result += `${text.context.primaryText}\n${context.primaryText}\n\n`;
    }

    if (context.rgSnippets && context.rgSnippets.length > 0) {
      result += `${text.context.codeSnippets}\n`;
      for (const snippet of context.rgSnippets) {
        result += `${text.context.snippetLocation(snippet.file, snippet.line)}\n${snippet.content}\n---\n`;
      }
    }

    if (context.gitDiff) {
      result += `${text.context.gitDiff}\n${context.gitDiff}\n\n`;
    }

    return result;
  }
}

export class StubLLM implements LLM {
  async createPlan(_context: Context, instruction: string, _lastError?: string): Promise<Plan> {
    // Return fixed Plan structure
    return {
      goal: `Implement functionality based on instruction "${instruction}"`,
      files: ['example.txt'],
      changes: ['Modify example file content'],
      verify: 'Check if changes are applied correctly',
    };
  }

  async createPatch(_context: Context, _plan: Plan, _lastError?: string): Promise<string> {
    // Return example diff
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

  async createPlan(): Promise<Plan> {
    return this.plans[this.planIndex++] || this.plans[this.plans.length - 1];
  }

  async createPatch(): Promise<string> {
    return this.patches[this.patchIndex++] || this.patches[this.patches.length - 1];
  }
}
