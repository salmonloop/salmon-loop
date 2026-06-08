import { z } from 'zod';

import { text } from '../../../locales/index.js';
import type { ToolRuntimeCtx } from '../../tools/types.js';
import { ToolSpec } from '../../tools/types.js';
import { Phase } from '../../types/runtime.js';
import { createSubAgentController } from '../controller.js';
import { SubAgentManager } from '../core/manager.js';
import type { SubAgentHandle, SubAgentResult } from '../types.js';

const AgentAwaitInputSchema = z.object({
  agentId: z
    .string()
    .min(1)
    .describe('The agent ID returned by agent_dispatch in async mode.'),
  timeout_seconds: z
    .number()
    .positive()
    .optional()
    .describe('Maximum time to wait for the result. Defaults to the agent profile timeout.'),
});

/**
 * agent_await (Internal: Smallfry Result Collector)
 * Waits for an asynchronously dispatched sub-agent to complete and returns its result.
 */
export const agentAwaitTaskSpec: ToolSpec = {
  name: 'agent_await',
  source: 'builtin',
  intent: 'AGENT',
  description: text.smallfry.ui.awaitToolDescription,

  riskLevel: 'low',
  defaultTimeoutMs: 300_000,
  sideEffects: ['none'],
  concurrency: 'parallel_ok',
  allowedPhases: [Phase.PLAN, Phase.CONTEXT, Phase.AUTOPILOT],

  inputSchema: AgentAwaitInputSchema,
  outputSchema: z.any(), // Maps to SubAgentResult
  examples: [
    {
      description: 'Await the result of an async sub-agent',
      input: {
        agentId: 'smallfry-a1b2c3d4',
      },
      output: {
        success: true,
        agent_ref: 'explorer',
        summary: '<diagnosis and findings>',
      },
    },
  ],

  executor: async (input: unknown, ctx: ToolRuntimeCtx): Promise<SubAgentResult> => {
    const parsed = AgentAwaitInputSchema.parse(input);
    const manager = new SubAgentManager(ctx, ctx.subAgentController ?? createSubAgentController());

    const handle: SubAgentHandle = {
      agentId: parsed.agentId,
      status: 'working',
      taskId: parsed.agentId,
    };

    try {
      return await manager.awaitResult(handle);
    } catch (error) {
      return {
        success: false,
        agent_ref: parsed.agentId,
        reason: error instanceof Error ? error.message : String(error),
        reasonCode: 'AWAIT_FAILED',
      };
    }
  },
};
