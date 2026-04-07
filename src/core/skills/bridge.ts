import { z } from 'zod';

import { tryGetLogger } from '../observability/logger.js';
import type { ToolRouter } from '../tools/router.js';
import { ToolRuntimeCtx, ToolSpec } from '../tools/types.js';

import {
  emitSkillAuditEvent,
  generateSkillTraceId,
  hashSkillArgs,
} from './audit.js';
import { getSkillFeatureFlags } from './feature-flags.js';
import { executeSkill } from './runtime/SkillRunner.js';
import { Skill } from './types.js';

/**
 * Check whether the bridge execution path kill-switch is active.
 *
 * Delegates to the centralized {@link getSkillFeatureFlags} module which
 * reads `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC` from the environment.
 *
 *   - 'true' or '1'  → bridge disabled (kill-switch ON)
 *   - 'false' or '0' → bridge enabled  (kill-switch OFF)
 *   - not set         → disabled in non-dev, enabled in development
 *
 * @see Requirements 9.4, 11.4
 */
export function isBridgeSkillExecDisabled(): boolean {
  return getSkillFeatureFlags().bridgeDisabled;
}

/**
 * A mutable box holding a ToolRouter reference.
 *
 * Used to break the circular dependency between skill registration (which
 * needs a router reference in the executor closure) and router creation
 * (which needs the final filtered registry). The box is created before
 * filtering, passed into skill executors, and filled after the router is
 * constructed.
 */
export interface RouterBox {
  router: ToolRouter | null;
}

/**
 * Bridges a Skill into a ToolSpec compatible with the standard tool registry.
 *
 * The executor delegates to executeSkill() which routes all shell commands
 * through ToolRouter governance (Registry → Validation → Policy → Auth).
 *
 * When the kill-switch env var `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC` is
 * set to 'true' or '1', the executor returns a DENIED result and emits
 * a SKILL_EXECUTION_DENIED audit event instead of executing the skill.
 *
 * @param routerBox - A mutable box whose `.router` field will be populated
 *   after the ToolRouter is created. The executor reads it lazily at call
 *   time, so it is safe to pass an initially-null box.
 */
export function skillToToolSpec(skill: Skill, routerBox: RouterBox): ToolSpec {
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
      if (isBridgeSkillExecDisabled()) {
        const traceId = generateSkillTraceId(skill.id);
        const argsHash = hashSkillArgs(input.args || '');

        emitSkillAuditEvent({
          type: 'SKILL_EXECUTION_DENIED',
          skillId: skill.id,
          route: 'tool-bridge',
          runnerClass: 'MicroTaskRunner',
          commandCount: 0,
          authorizationMode: 'blocking',
          argsHash,
          traceId,
          denyReason: 'BRIDGE_KILL_SWITCH',
          denySource: 'env:SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC',
        });

        const logger = tryGetLogger();
        logger?.warn(
          `Bridge skill execution denied by kill-switch for skill "${skill.id}" (traceId=${traceId})`,
        );

        return { prompt: '', status: 'DENIED' };
      }

      // Lazily read the router from the box — it is populated after filtering.
      const toolRouter = routerBox.router;
      if (!toolRouter) {
        throw new Error(`ToolRouter not yet initialized for skill "${skill.id}"`);
      }

      const result = await executeSkill({
        skill,
        argsText: input.args || '',
        toolRouter,
        toolCtx: ctx,
        route: 'tool-bridge',
      });

      return {
        prompt: result.injectedPrompt,
        status: result.status,
      };
    },
  };
}
