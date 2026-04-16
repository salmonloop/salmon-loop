import { z } from 'zod';

import { tryGetLogger } from '../observability/logger.js';
import type { ToolRouter } from '../tools/router.js';
import { ToolRuntimeCtx, ToolSpec } from '../tools/types.js';

import { emitSkillAuditEvent, generateSkillTraceId, hashSkillArgs } from './audit.js';
import { getSkillFeatureFlags } from './feature-flags.js';
import type { SkillLoader } from './loader.js';
import { executeSkill } from './runtime/SkillRunner.js';
import { Skill, SkillCatalogEntry } from './types.js';

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
 * Source descriptor for skillToToolSpec.
 *
 * Supports two modes:
 * - Direct: a fully loaded {@link Skill} object (legacy / slash-governed path)
 * - Lazy (progressive disclosure): a catalog entry + loader reference.
 *   The full skill content is loaded on demand via {@link SkillLoader.activateSkill}
 *   when the executor is first invoked (Tier 2 activation).
 *
 * @see https://agentskills.io/specification — Progressive disclosure
 */
export type SkillSource = Skill | { entry: SkillCatalogEntry; loader: SkillLoader };

function isLazySource(
  source: SkillSource,
): source is { entry: SkillCatalogEntry; loader: SkillLoader } {
  return 'entry' in source && 'loader' in source;
}

/**
 * Bridges a Skill (or catalog entry) into a ToolSpec compatible with the
 * standard tool registry.
 *
 * When given a catalog entry + loader, the executor performs Tier 2 activation
 * on first invocation (progressive disclosure). When given a full Skill, it
 * executes immediately.
 *
 * The executor delegates to executeSkill() which routes all shell commands
 * through ToolRouter governance (Registry → Validation → Policy → Auth).
 *
 * When the kill-switch env var `SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC` is
 * set to 'true' or '1', the executor returns a DENIED result and emits
 * a SKILL_EXECUTION_DENIED audit event instead of executing the skill.
 *
 * @param source - Either a full {@link Skill} or a `{ entry, loader }` pair
 *   for lazy activation.
 * @param routerBox - A mutable box whose `.router` field will be populated
 *   after the ToolRouter is created. The executor reads it lazily at call
 *   time, so it is safe to pass an initially-null box.
 */
export function skillToToolSpec(source: SkillSource, routerBox: RouterBox): ToolSpec {
  const skillId = isLazySource(source) ? source.entry.id : source.id;
  const description = isLazySource(source) ? source.entry.description : source.metadata.description;

  // Cache for lazily activated skill (Tier 2)
  let activatedSkill: Skill | null = isLazySource(source) ? null : source;

  return {
    name: skillId,
    source: 'plugin',
    intent: 'AGENT',
    description,
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
        const traceId = generateSkillTraceId(skillId);
        const argsHash = hashSkillArgs(input.args || '');

        emitSkillAuditEvent({
          type: 'SKILL_EXECUTION_DENIED',
          skillId,
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
          `Bridge skill execution denied by kill-switch for skill "${skillId}" (traceId=${traceId})`,
        );

        return { prompt: '', status: 'DENIED' };
      }

      // Tier 2 activation: load full skill content on first invocation
      if (!activatedSkill) {
        const lazySource = source as { entry: SkillCatalogEntry; loader: SkillLoader };
        activatedSkill = await lazySource.loader.activateSkill(lazySource.entry.id);
      }

      // Lazily read the router from the box — it is populated after filtering.
      const toolRouter = routerBox.router;
      if (!toolRouter) {
        throw new Error(`ToolRouter not yet initialized for skill "${skillId}"`);
      }

      const result = await executeSkill({
        skill: activatedSkill,
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
