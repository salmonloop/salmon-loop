import { getLogger } from '../observability/logger.js';
import { getPromptRegistry } from '../prompts/registry.js';
import { executeUpdateKnowledge } from '../tools/builtin/knowledge.js';
import { LLM } from '../types/index.js';

import { ReflectionInput, ReflectionResult } from './types.js';

// Frequency limiter for success reflections: at most once per N successes
let successReflectionCounter = 0;
const SUCCESS_REFLECTION_INTERVAL = 5;

export class ReflectionEngine {
  constructor(private readonly llm: LLM) {}

  /**
   * Main reflection: failures followed by success.
   * Extracts "what went wrong and how it was fixed".
   */
  async reflect(input: ReflectionInput, repoRoot: string): Promise<ReflectionResult> {
    const promptRegistry = getPromptRegistry();
    await promptRegistry.init();

    const failures = input.history.filter((h) => h.error);
    if (failures.length === 0 || !input.success) {
      return { lessons: [] };
    }

    getLogger().debug(`[Reflection] Triggering reflection for ${failures.length} failures.`);

    const prompt = promptRegistry.renderReflection(input);

    try {
      const response = await this.llm.chat([{ role: 'user', content: prompt }], {
        responseFormat: 'json_object',
      });

      const content = response.content;
      const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || content;
      const result = JSON.parse(jsonStr) as ReflectionResult;

      await this.persistKnowledge(result, repoRoot);

      getLogger().debug(
        `[Reflection] Reflection completed with ${result.lessons?.length ?? 0} lessons.`,
      );
      return result;
    } catch (e) {
      getLogger().warn(
        `[Reflection] Failed to perform reflection: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { lessons: [] };
    }
  }

  /**
   * Reflect on first-try success (attempt === 1).
   * Extracts "what was done right" as positive patterns.
   * Frequency-limited: at most once every SUCCESS_REFLECTION_INTERVAL successes.
   */
  async reflectOnSuccess(input: ReflectionInput, repoRoot: string): Promise<ReflectionResult> {
    successReflectionCounter++;
    if (successReflectionCounter % SUCCESS_REFLECTION_INTERVAL !== 0) {
      return { lessons: [] };
    }

    const promptRegistry = getPromptRegistry();
    await promptRegistry.init();

    getLogger().debug('[Reflection] Triggering success reflection (first-try success).');

    const successPrompt = [
      'The task was completed successfully on the first attempt.',
      `Instruction: ${input.instruction}`,
      '',
      'Analyze what was done correctly. Extract 1-2 concise positive patterns that contributed to success.',
      'Return JSON: { "lessons": ["..."], "suggestedDecisions": ["..."] }',
      'Each decision should be a short, actionable pattern (10-200 chars).',
    ].join('\n');

    try {
      const response = await this.llm.chat([{ role: 'user', content: successPrompt }], {
        responseFormat: 'json_object',
      });

      const content = response.content;
      const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || content;
      const result = JSON.parse(jsonStr) as ReflectionResult;

      if (result.suggestedDecisions && result.suggestedDecisions.length > 0) {
        const mockCtx: any = { repoRoot };
        for (const decision of result.suggestedDecisions) {
          await executeUpdateKnowledge(
            {
              category: 'architectural_decisions',
              decision,
            },
            mockCtx,
          );
        }
      }

      await this.persistLessons(result.lessons, repoRoot, 'success');

      return result;
    } catch (e) {
      getLogger().warn(
        `[Reflection] Failed to perform success reflection: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { lessons: [] };
    }
  }

  /**
   * Reflect on final failure (all retries exhausted).
   * Extracts "why it failed" as deprecated approaches.
   * No LLM call — structured extraction from failure history.
   */
  async reflectOnFailure(input: ReflectionInput, repoRoot: string): Promise<ReflectionResult> {
    const failures = input.history.filter((h) => h.error);
    if (failures.length === 0) return { lessons: [] };

    getLogger().debug(
      `[Reflection] Extracting failure lessons from ${failures.length} failed attempts.`,
    );

    // Structured extraction: collect unique error patterns
    const errorPatterns = new Set<string>();
    for (const entry of failures) {
      if (!entry.error) continue;
      const summary =
        typeof entry.contextSummary === 'string'
          ? entry.contextSummary.slice(0, 200)
          : String(entry.error).slice(0, 200);
      errorPatterns.add(summary);
    }

    const lessons = Array.from(errorPatterns).map((pattern) => `Approach failed: ${pattern}`);

    // Write deprecated rules
    const deprecatedApproaches = Array.from(errorPatterns).map(
      (pattern) => `Avoid: ${pattern.slice(0, 100)}`,
    );

    if (deprecatedApproaches.length > 0) {
      const mockCtx: any = { repoRoot };
      await executeUpdateKnowledge(
        {
          category: 'project_rules',
          rules: [],
          deprecated_rules: deprecatedApproaches,
        },
        mockCtx,
      ).catch((e: unknown) => {
        getLogger().warn(`[Reflection] Failed to persist failure lessons: ${String(e)}`);
      });
    }

    await this.persistLessons(lessons, repoRoot, 'failure');

    return { lessons };
  }

  private async persistKnowledge(result: ReflectionResult, repoRoot: string): Promise<void> {
    if (result.suggestedRules && result.suggestedRules.length > 0) {
      const mockCtx: any = { repoRoot };
      await executeUpdateKnowledge(
        {
          category: 'project_rules',
          rules: result.suggestedRules,
          deprecated_rules: result.deprecatedRules,
        },
        mockCtx,
      );
    }

    if (result.suggestedDecisions && result.suggestedDecisions.length > 0) {
      const mockCtx: any = { repoRoot };
      for (const decision of result.suggestedDecisions) {
        await executeUpdateKnowledge(
          {
            category: 'architectural_decisions',
            decision,
          },
          mockCtx,
        );
      }
    }

    await this.persistLessons(result.lessons, repoRoot, 'success');
  }

  private async persistLessons(
    lessons: string[],
    repoRoot: string,
    source?: 'success' | 'failure',
  ): Promise<void> {
    if (lessons.length === 0) return;
    const mockCtx: any = { repoRoot };
    await executeUpdateKnowledge(
      {
        category: 'lessons_learned',
        lessons,
        source,
      },
      mockCtx,
    ).catch((e: unknown) => {
      getLogger().warn(`[Reflection] Failed to persist lessons: ${String(e)}`);
    });
  }
}
