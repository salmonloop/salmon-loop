import { z } from 'zod';

import { text } from '../../../locales/index.js';
import type { ToolRuntimeCtx } from '../../tools/types.js';
import { ToolSpec } from '../../tools/types.js';
import { SubAgentManager } from '../core/manager.js';
import { SubAgentRequestSchema, SubAgentResult } from '../types.js';

/**
 * agent_dispatch (Internal: Smallfry Dispatcher)
 * The primary tool for spawning autonomous sub-agents to handle specialized sub-tasks.
 */
export const subAgentTaskSpec: ToolSpec = {
  name: 'agent_dispatch',
  source: 'builtin',
  intent: 'AGENT',
  description: text.smallfry.ui.spawnToolDescription,

  riskLevel: 'medium',
  // This tool is proposal-only: it may read the repo and produce structured proposals,
  // but it MUST NOT mutate the user's workspace from within the calling phase.
  sideEffects: ['none', 'fs_read', 'git_read'],
  concurrency: 'parallel_ok', // Smallfrys handle their own isolation
  allowedPhases: ['PLAN', 'CONTEXT'],

  inputSchema: SubAgentRequestSchema,
  outputSchema: z.any(), // Maps to SubAgentResult

  executor: async (input: any, ctx: ToolRuntimeCtx): Promise<SubAgentResult> => {
    const manager = new SubAgentManager(ctx);

    // Launch the Smallfry via the manager
    return await manager.execute(input);
  },
};
