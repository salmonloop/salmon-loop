import { z } from 'zod';

import { writeFile, mkdir } from '../../adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../config/paths.js';
import { Phase } from '../../types/index.js';
import { safeJoin } from '../../utils/path.js';
import { ToolSpec, ToolRuntimeCtx } from '../types.js';

const updateKnowledgeInputSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('project_rules'),
    rules: z.array(z.string()).describe('Full list of active project rules and coding standards'),
    deprecated_rules: z
      .array(z.string())
      .optional()
      .describe('List of previously recorded rules that are no longer valid or have been replaced'),
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
  const knowledgeDir = safeJoin(indexPath, 'knowledge');

  // Use high-resolution timestamp + category for unique append-only filenames
  const timestamp = Date.now();
  const fileName = `${timestamp}-${input.category}.json`;
  const filePath = safeJoin(knowledgeDir, fileName);

  let dataToSave: any = {};
  switch (input.category) {
    case 'project_rules':
      dataToSave = {
        project_rules: input.rules,
        deprecated_rules: input.deprecated_rules,
      };
      break;
    case 'architectural_decisions':
      dataToSave = {
        architectural_decisions: [
          {
            date: new Date().toISOString().split('T')[0],
            decision: input.decision,
            related_files: input.related_files,
          },
        ],
      };
      break;
    case 'user_preferences':
      dataToSave = { user_preferences: input.preferences };
      break;
  }

  try {
    await mkdir(knowledgeDir, { recursive: true });
    await writeFile(filePath, JSON.stringify(dataToSave, null, 2));
    return {
      success: true,
      message: `Successfully recorded knowledge event: ${fileName}`,
    };
  } catch (e) {
    throw new Error(
      `Failed to record knowledge event: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
