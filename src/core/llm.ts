import OpenAI from 'openai';
import type { Context, Plan } from './types.js';
import { getPlanPrompt, getPatchPrompt } from './prompts.js';
import { LIMITS } from './limits.js';
import { text } from '../locales/index.js';

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
    const prompt = getPlanPrompt(this.formatContext(context), instruction, LIMITS.maxFilesChanged, lastError);
    
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
      const plan = JSON.parse(content) as Plan;
      // Validate plan structure
      if (!plan.goal || !Array.isArray(plan.files) || !Array.isArray(plan.changes) || !plan.verify) {
        throw new Error(text.llm.planInvalid);
      }
      return plan;
    } catch (e) {
      throw new Error(text.llm.planParseFailed(content, String(e)));
    }
  }

  async createPatch(context: Context, plan: Plan, lastError?: string): Promise<string> {
    const planStr = JSON.stringify(plan, null, 2);
    const prompt = getPatchPrompt(planStr, this.formatContext(context), LIMITS.maxFilesChanged, LIMITS.maxDiffLines, lastError);

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error(text.llm.patchEmpty);
    }

    // Clean up markdown code blocks if present
    let cleanContent = content;
    // Remove ```diff or ``` at start
    cleanContent = cleanContent.replace(/^```(?:diff)?\s*\n/, '');
    // Remove ``` at end
    cleanContent = cleanContent.replace(/\n```\s*$/, '');
    
    return cleanContent.trim();
  }

  private formatContext(context: Context): string {
    let result = `Repository Path: ${context.repoPath}\n\n`;
    
    if (context.primaryText) {
      result += `Primary Text:\n${context.primaryText}\n\n`;
    }
    
    if (context.rgSnippets && context.rgSnippets.length > 0) {
      result += `Code Snippets:\n`;
      for (const snippet of context.rgSnippets) {
        result += `File: ${snippet.file}:${snippet.line}\n${snippet.content}\n---\n`;
      }
    }
    
    if (context.gitDiff) {
      result += `Git Diff:\n${context.gitDiff}\n\n`;
    }

    return result;
  }
}

export class StubLLM implements LLM {
  async createPlan(context: Context, instruction: string, lastError?: string): Promise<Plan> {
    // Return fixed Plan structure
    return {
      goal: `Implement functionality based on instruction "${instruction}"`,
      files: ['example.txt'],
      changes: ['Modify example file content'],
      verify: 'Check if changes are applied correctly'
    };
  }

  async createPatch(context: Context, plan: Plan, lastError?: string): Promise<string> {
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
