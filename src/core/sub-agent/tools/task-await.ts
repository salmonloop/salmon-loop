import { z } from 'zod';

import { text } from '../../../locales/index.js';
import type { ToolRuntimeCtx } from '../../tools/types.js';
import { ToolSpec } from '../../tools/types.js';
import { Phase } from '../../types/runtime.js';
import { createSubAgentController } from '../controller.js';
import type { SubAgentResult } from '../types.js';

const AgentAwaitInputSchema = z.object({
  agentId: z.string().min(1).describe('The agent ID returned by agent_dispatch in async mode.'),
  timeout_seconds: z
    .number()
    .positive()
    .optional()
    .describe('Maximum time to wait for the result. Defaults to the agent profile timeout.'),
});

/**
 * agent_await (Internal: Smallfry Result Collector)
 * Waits for an asynchronously dispatched sub-agent to complete and returns its result.
 * Polls the shared controller (same instance used by agent_dispatch) for agent status.
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
    const controller = ctx.subAgentController ?? createSubAgentController();
    const timeoutMs = parsed.timeout_seconds ? parsed.timeout_seconds * 1000 : 300_000;

    try {
      // Try awaiting the specific agent ID first (short timeout — if the ID is a
      // placeholder like '{{handle}}' that no one will resolve, we must fall through
      // to the scanning fallback quickly).
      let result = await controller.awaitResult(parsed.agentId, Math.min(timeoutMs, 200));

      // If not found (e.g., LLM used a placeholder), wait for any pending agent.
      if (!result) {
        const agents = controller.listAgents();
        for (const agent of agents) {
          if (agent.status === 'terminated') {
            // Already completed — try to get the stored result
            result = await controller.awaitResult(agent.id, 0);
            if (result) break;
          }
        }
      }

      // If still no result, wait for the first agent to complete
      if (!result) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const agents = controller.listAgents();
          for (const agent of agents) {
            if (agent.status === 'terminated') {
              result = await controller.awaitResult(agent.id, 0);
              if (result) break;
            }
          }
          if (result) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      if (result) return result;

      // Timeout
      return {
        success: false,
        agent_ref: parsed.agentId,
        summary: `Timed out waiting for agent ${parsed.agentId}`,
        reason: `Timed out after ${timeoutMs}ms`,
        reasonCode: 'AWAIT_FAILED',
        tokenUsage: 0,
        attempts: 1,
        logs: [],
      };
    } catch (error) {
      return {
        success: false,
        agent_ref: parsed.agentId,
        summary: error instanceof Error ? error.message : String(error),
        reason: error instanceof Error ? error.message : String(error),
        reasonCode: 'AWAIT_FAILED',
        tokenUsage: 0,
        attempts: 1,
        logs: [],
      };
    }
  },
};
