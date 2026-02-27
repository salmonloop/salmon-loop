import { z } from 'zod';

import { readFile, writeFile, mkdir } from '../../adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../config/paths.js';
import { Phase } from '../../types/index.js';
import { safeJoin } from '../../utils/path.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

const updateKnowledgeInputSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('project_rules'),
    rules: z.array(z.string()).describe('Full list of project rules and coding standards'),
  }),
  z.object({
    category: z.literal('architectural_decisions'),
    decision: z.string().describe('The new architectural decision to record'),
    related_files: z.array(z.string()).optional().describe('Files affected by this decision'),
  }),
  z.object({
    category: z.literal('user_preferences'),
    preferences: z.string().describe('Updated description of user personal preferences'),
  }),
]);

export const updateKnowledgeSpec: Omit<ToolSpec, 'executor'> = {
  name: 'update_knowledge',
  source: 'builtin',
  intent: 'WRITE',
  description: 'Persist project-specific knowledge, rules, and decisions for cross-session memory.',
  riskLevel: 'low',
  sideEffects: ['fs_write'],
  concurrency: 'parallel_ok',
  inputSchema: updateKnowledgeInputSchema,
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  allowedPhases: [Phase.EXPLORE, Phase.PLAN, Phase.PATCH],
};

export async function executeUpdateKnowledge(
  input: z.infer<typeof updateKnowledgeInputSchema>,
  ctx: ToolRuntimeCtx,
) {
  const { repoRoot } = ctx;
  const indexPath = getDefaultIndexPath(repoRoot);
  const knowledgeFile = safeJoin(indexPath, 'knowledge.json');

  let currentKnowledge: any = {};
  try {
    const content = await readFile(knowledgeFile, 'utf-8');
    currentKnowledge = JSON.parse(content);
  } catch {
    // New file or invalid JSON
  }

  switch (input.category) {
    case 'project_rules':
      currentKnowledge.project_rules = input.rules;
      break;
    case 'architectural_decisions':
      if (!currentKnowledge.architectural_decisions) {
        currentKnowledge.architectural_decisions = [];
      }
      currentKnowledge.architectural_decisions.push({
        date: new Date().toISOString().split('T')[0],
        decision: input.decision,
        related_files: input.related_files,
      });
      break;
    case 'user_preferences':
      currentKnowledge.user_preferences = input.preferences;
      break;
  }

  try {
    await mkdir(indexPath, { recursive: true });
    await writeFile(knowledgeFile, JSON.stringify(currentKnowledge, null, 2));
    return {
      success: true,
      message: `Successfully updated knowledge category: ${input.category}`,
    };
  } catch (e) {
    throw new Error(
      `Failed to update knowledge base: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
