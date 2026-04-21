import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { recordAuditEvent } from '../../observability/audit-trail.js';
import type { ToolRuntimeCtx } from '../../tools/types.js';
import { ToolSpec } from '../../tools/types.js';
import { Phase } from '../../types/runtime.js';
import { mergeSubAgentContextSnapshot } from '../context-snapshot.js';
import { createSubAgentController } from '../controller.js';
import { SubAgentManager } from '../core/manager.js';
import { validateSharedPrefixConsistency } from '../prefix-consistency.js';
import { SubAgentRequestSchema, type SubAgentRequest, type SubAgentResult } from '../types.js';

function normalizeDispatchRequest(input: SubAgentRequest, ctx: ToolRuntimeCtx): SubAgentRequest {
  if (input.session_target !== 'shared') {
    return input;
  }

  const consistency = validateSharedPrefixConsistency({
    requestSnapshot: input.contextSnapshot,
    runtimeSnapshot: ctx.contextSnapshot,
  });
  if (!consistency.compatible) {
    recordAuditEvent(
      'sub_agent.shared.prefix_consistency_failed',
      {
        metric: 'shared_fallback_rate',
        fallbackMode: 'isolated',
        reason: consistency.reason,
        expected: consistency.expected,
        actual: consistency.actual,
      },
      {
        source: 'smallfry',
        severity: 'medium',
        scope: 'session',
        phase: ctx.phase,
      },
    );
    return {
      ...input,
      session_target: 'isolated',
      contextSnapshot: undefined,
    };
  }

  return {
    ...input,
    contextSnapshot: mergeSubAgentContextSnapshot(input.contextSnapshot, ctx.contextSnapshot),
  };
}

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
  allowedPhases: [Phase.PLAN, Phase.CONTEXT, Phase.AUTOPILOT],

  inputSchema: SubAgentRequestSchema,
  outputSchema: z.any(), // Maps to SubAgentResult

  executor: async (input: any, ctx: ToolRuntimeCtx): Promise<SubAgentResult> => {
    const manager = new SubAgentManager(ctx, ctx.subAgentController ?? createSubAgentController());
    const request = normalizeDispatchRequest(input as SubAgentRequest, ctx);

    // Launch the Smallfry via the manager
    return await manager.execute(request);
  },
};
