import { z } from 'zod';

import type { ToolRuntimeCtx } from '../../tools/types.js';
import { ToolSpec } from '../../tools/types.js';
import { Phase } from '../../types/runtime.js';
import { getOrCreateTeam } from '../team.js';

const AgentTeamInputSchema = z.object({
  action: z
    .enum(['claim', 'release', 'list', 'is_claimed'])
    .describe('Action: claim a task key, release a claim, list all claims, or check if claimed.'),
  taskKey: z
    .string()
    .optional()
    .describe(
      'The task/file key to claim, release, or check. Required for claim/release/is_claimed.',
    ),
  teamId: z.string().min(1).describe('The team ID to operate on.'),
});

/**
 * agent_team — Coordination tool for parallel sub-agents.
 * Allows sub-agents to claim tasks/files and query the team board
 * to avoid duplicate work.
 */
export const agentTeamSpec: ToolSpec = {
  name: 'agent_team',
  source: 'builtin',
  intent: 'AGENT',
  description:
    'Coordinate with parallel sub-agents. Use "claim" to declare you are working on a task/file, "list" to see current claims, "is_claimed" to check availability, "release" to free a claim.',

  riskLevel: 'low',
  defaultTimeoutMs: 5_000,
  sideEffects: ['none'],
  concurrency: 'parallel_ok',
  allowedPhases: [Phase.PLAN, Phase.CONTEXT, Phase.AUTOPILOT],

  inputSchema: AgentTeamInputSchema,
  outputSchema: z.any(),
  examples: [
    {
      description: 'Claim a file for editing',
      input: { action: 'claim', taskKey: 'src/utils/parser.ts', teamId: 'team-alpha' },
      output: { success: true, claimed: true },
    },
    {
      description: 'Check if a file is already claimed',
      input: { action: 'is_claimed', taskKey: 'src/utils/parser.ts', teamId: 'team-alpha' },
      output: { claimed: true, claimedBy: 'smallfry-a1b2c3d4' },
    },
    {
      description: 'List all current claims',
      input: { action: 'list', teamId: 'team-alpha' },
      output: {
        claims: [
          {
            taskKey: 'src/utils/parser.ts',
            claimedBy: 'smallfry-a1b2c3d4',
            claimedAt: 1717800000000,
          },
        ],
      },
    },
  ],

  executor: async (input: unknown, ctx: ToolRuntimeCtx): Promise<unknown> => {
    const parsed = AgentTeamInputSchema.parse(input);
    const agentId = ctx.agentId ?? 'unknown';
    const team = getOrCreateTeam(parsed.teamId);

    switch (parsed.action) {
      case 'claim': {
        if (!parsed.taskKey) return { success: false, error: 'taskKey required for claim' };
        const claimed = team.claim(parsed.taskKey, agentId);
        return { success: true, claimed };
      }
      case 'release': {
        if (!parsed.taskKey) return { success: false, error: 'taskKey required for release' };
        const released = team.release(parsed.taskKey, agentId);
        return { success: true, released };
      }
      case 'is_claimed': {
        if (!parsed.taskKey) return { success: false, error: 'taskKey required for is_claimed' };
        const existing = team.listClaims().find((c) => c.taskKey === parsed.taskKey);
        return {
          success: true,
          claimed: team.isClaimed(parsed.taskKey),
          claimedBy: existing?.claimedBy,
        };
      }
      case 'list': {
        const claims = team.listClaims();
        return { success: true, claims };
      }
      default:
        return { success: false, error: `Unknown action: ${parsed.action}` };
    }
  },
};
