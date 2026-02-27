import { logger } from '../observability/logger.js';
import { promptRegistry } from '../prompts/registry.js';
import { executeUpdateKnowledge } from '../tools/builtin/knowledge.js';
import { LLM } from '../types/index.js';

import { ReflectionInput, ReflectionResult } from './types.js';

export class ReflectionEngine {
  constructor(private readonly llm: LLM) {}

  async reflect(input: ReflectionInput, repoRoot: string): Promise<ReflectionResult> {
    await promptRegistry.init();

    // Only reflect if there were failures and final success
    const failures = input.history.filter((h) => h.error);
    if (failures.length === 0 || !input.success) {
      return { lessons: [] };
    }

    logger.debug(`[Reflection] Triggering reflection for ${failures.length} failures.`);

    const prompt = promptRegistry.renderReflection(input);

    try {
      const response = await this.llm.chat([{ role: 'user', content: prompt }], {
        responseFormat: 'json_object',
      });

      const content = response.content;
      // Extract JSON from response (handle potential markdown markers)
      const jsonStr = content.match(/\{[\s\S]*\}/)?.[0] || content;
      const result = JSON.parse(jsonStr) as ReflectionResult;

      // Persist suggested knowledge if any
      if (result.suggestedRules && result.suggestedRules.length > 0) {
        // Since we are in the engine, we can call the executor directly
        // We need a minimal mock context
        const mockCtx: any = { repoRoot };
        await executeUpdateKnowledge(
          {
            category: 'project_rules',
            rules: result.suggestedRules,
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

      logger.debug(
        `[Reflection] Reflection completed with ${result.lessons?.length ?? 0} lessons.`,
      );
      return result;
    } catch (e) {
      logger.warn(
        `[Reflection] Failed to perform reflection: ${e instanceof Error ? e.message : String(e)}`,
      );
      return { lessons: [] };
    }
  }
}
