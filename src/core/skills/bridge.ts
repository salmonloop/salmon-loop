import { z } from 'zod';

import { ToolRuntimeCtx, ToolSpec } from '../tools/types.js';

import { MicroTaskRunner } from './runtime/MicroTaskRunner.js';
import { Skill } from './types.js';

/**
 * Bridges a Skill into a ToolSpec compatible with the standard tool registry.
 */
export function skillToToolSpec(skill: Skill): ToolSpec {
  return {
    name: skill.id,
    source: 'plugin',
    intent: 'AGENT',
    description: skill.metadata.description,
    riskLevel: 'medium',
    sideEffects: ['process', 'fs_read'],
    concurrency: 'serial_only',
    allowedPhases: ['PLAN', 'APPLY'],

    inputSchema: z.object({
      args: z.string().optional().describe('Arguments to pass to the skill'),
    }),

    outputSchema: z.object({
      prompt: z.string(),
      status: z.string(),
    }),

    executor: async (input: { args?: string }, ctx: ToolRuntimeCtx) => {
      const runner = new MicroTaskRunner(skill);
      const result = await runner.execute({ args: input.args || '' }, ctx);

      return {
        prompt: result.injectedPrompt,
        status: result.status,
      };
    },
  };
}
