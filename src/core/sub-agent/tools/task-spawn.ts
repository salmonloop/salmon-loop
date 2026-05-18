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
  const requested: SubAgentRequest = {
    ...input,
    session_target: input.session_target ?? 'isolated',
    expected_output:
      input.expected_output ??
      (input.agent_ref === 'surgeon' || input.agent_ref === 'cleaner'
        ? 'patch'
        : input.agent_ref === 'reviewer'
          ? 'review'
          : 'diagnosis'),
  };

  if (requested.session_target !== 'shared') {
    return requested;
  }

  const consistency = validateSharedPrefixConsistency({
    requestSnapshot: requested.contextSnapshot,
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
      ...requested,
      session_target: 'isolated',
      contextSnapshot: undefined,
    };
  }

  return {
    ...requested,
    contextSnapshot: mergeSubAgentContextSnapshot(requested.contextSnapshot, ctx.contextSnapshot),
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
  defaultTimeoutMs: 180_000,
  // This tool is proposal-only: it may read the repo and produce structured proposals,
  // but it MUST NOT mutate the user's workspace from within the calling phase.
  sideEffects: ['none', 'fs_read', 'git_read'],
  concurrency: 'parallel_ok', // Smallfrys handle their own isolation
  allowedPhases: [Phase.PLAN, Phase.CONTEXT, Phase.AUTOPILOT],

  inputSchema: SubAgentRequestSchema,
  outputSchema: z.any(), // Maps to SubAgentResult
  examples: [
    {
      description: 'Ask a read-only explorer to inspect failing tests before editing',
      input: {
        agent_ref: 'explorer',
        task: 'Inspect src/order.js, src/inventory.js, and test/order.test.js. Identify why the order pricing tests fail and return a concise diagnosis with recommended files to edit.',
        contextFiles: ['src/order.js', 'src/inventory.js', 'test/order.test.js'],
        expected_output: 'diagnosis',
      },
      output: {
        success: true,
        agent_ref: 'explorer',
        summary: '<diagnosis and recommended next steps>',
      },
    },
    {
      description: 'Ask a reviewer to audit a proposed implementation',
      input: {
        agent_ref: 'reviewer',
        task: 'Review the current changes for correctness, missing edge cases, and behavior covered by tests. Return findings only.',
        expected_output: 'review',
      },
      output: {
        success: true,
        agent_ref: 'reviewer',
        summary: '<review findings>',
      },
    },
  ],

  executor: async (input: any, ctx: ToolRuntimeCtx): Promise<SubAgentResult> => {
    const manager = new SubAgentManager(ctx, ctx.subAgentController ?? createSubAgentController());
    const request = normalizeDispatchRequest(input as SubAgentRequest, ctx);

    // Launch the Smallfry via the manager
    return await manager.execute(request);
  },
};
