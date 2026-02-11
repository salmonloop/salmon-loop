import { z } from 'zod';

import { text } from '../../../locales/index.js';
import { initPlan, readPlan, updatePlan } from '../../plan/index.js';
import { Phase } from '../../types.js';
import type { ResourceKey } from '../parallel/resources.js';
import type { ToolSpec, ToolRuntimeCtx } from '../types.js';

const sessionIdSchema = z
  .string()
  .min(6)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .describe('Plan session ID (opaque).');

const stepIdSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/)
  .describe('Stable step ID (from <!-- sl:id=... -->).');

function planResource(ctx: ToolRuntimeCtx, sessionId?: string): ResourceKey[] {
  const repoId = ctx.persistenceRoot ?? ctx.repoRoot;
  if (!sessionId) return [{ kind: 'repo', id: repoId }];
  return [{ kind: 'pathPrefix', repoId, prefix: `.salmonloop/plans/${sessionId}/` }];
}

export const planInitSpec: ToolSpec<
  { mission: string; objective: string; context?: string },
  { sessionId: string; planPathHint: string; baseHash: string }
> = {
  name: 'plan.init',
  source: 'builtin',
  intent: 'WRITE',
  description: text.tools.planInitDescription,
  riskLevel: 'low',
  sideEffects: ['runtime_write'],
  concurrency: 'mutex_by_resource',
  computeResources: (_args, ctx) => planResource(ctx),
  allowedPhases: [Phase.EXPLORE, Phase.PLAN, Phase.PATCH, Phase.VERIFY, Phase.SHRINK],
  inputSchema: z.object({
    mission: z.string().min(1),
    objective: z.string().min(1),
    context: z.string().optional(),
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    planPathHint: z.string(),
    baseHash: z.string(),
  }),
  executor: async (input, ctx) => {
    const persistenceRoot = ctx.persistenceRoot ?? ctx.repoRoot;
    return initPlan({
      persistenceRoot,
      mission: input.mission,
      objective: input.objective,
      context: input.context,
    });
  },
};

export const planReadSpec: ToolSpec<{ sessionId: string }, any> = {
  name: 'plan.read',
  source: 'builtin',
  intent: 'READ',
  description: text.tools.planReadDescription,
  riskLevel: 'low',
  sideEffects: ['fs_read'],
  concurrency: 'parallel_ok',
  computeResources: (args, ctx) => planResource(ctx, args.sessionId),
  allowedPhases: [Phase.EXPLORE, Phase.PLAN, Phase.PATCH, Phase.VERIFY, Phase.SHRINK],
  inputSchema: z.object({
    sessionId: sessionIdSchema,
  }),
  outputSchema: z.object({
    sessionId: z.string(),
    baseHash: z.string(),
    active: z.array(
      z.object({
        stepId: z.string(),
        text: z.string(),
        checkbox: z.enum(['checked', 'unchecked']),
        status: z.enum(['todo', 'active', 'done', 'failed', 'skipped', 'conflict']),
      }),
    ),
    pending: z.array(
      z.object({
        stepId: z.string(),
        text: z.string(),
        checkbox: z.enum(['checked', 'unchecked']),
        status: z.enum(['todo', 'active', 'done', 'failed', 'skipped', 'conflict']),
      }),
    ),
    recentDone: z.array(
      z.object({
        stepId: z.string(),
        text: z.string(),
        checkbox: z.enum(['checked', 'unchecked']),
        status: z.enum(['todo', 'active', 'done', 'failed', 'skipped', 'conflict']),
      }),
    ),
    conflicts: z.object({ present: z.boolean(), summary: z.string().optional() }),
  }),
  executor: async (input, ctx) => {
    const persistenceRoot = ctx.persistenceRoot ?? ctx.repoRoot;
    return readPlan({ persistenceRoot, sessionId: input.sessionId });
  },
};

export const planUpdateSpec: ToolSpec<
  {
    sessionId: string;
    baseHash: string;
    stepId: string;
    patch: {
      status?: 'todo' | 'active' | 'done' | 'failed' | 'skipped' | 'conflict';
      checkbox?: 'checked' | 'unchecked';
      appendSubtasks?: string[];
      note?: string;
    };
  },
  any
> = {
  name: 'plan.update',
  source: 'builtin',
  intent: 'WRITE',
  description: text.tools.planUpdateDescription,
  riskLevel: 'low',
  sideEffects: ['runtime_write'],
  concurrency: 'mutex_by_resource',
  computeResources: (args, ctx) => planResource(ctx, args.sessionId),
  allowedPhases: [Phase.EXPLORE, Phase.PLAN, Phase.PATCH, Phase.VERIFY, Phase.SHRINK],
  inputSchema: z.object({
    sessionId: sessionIdSchema,
    baseHash: z.string().min(8),
    stepId: stepIdSchema,
    patch: z.object({
      status: z.enum(['todo', 'active', 'done', 'failed', 'skipped', 'conflict']).optional(),
      checkbox: z.enum(['checked', 'unchecked']).optional(),
      appendSubtasks: z.array(z.string().min(1)).optional(),
      note: z.string().optional(),
    }),
  }),
  outputSchema: z.union([
    z.object({
      ok: z.literal(true),
      sessionId: z.string(),
      baseHash: z.string(),
      updatedStepId: z.string(),
    }),
    z.object({
      ok: z.literal(false),
      sessionId: z.string(),
      baseHash: z.string(),
      conflict: z.object({
        code: z.enum([
          'BASE_HASH_MISMATCH',
          'STEP_NOT_FOUND',
          'MALFORMED_METADATA',
          'WRITE_DENIED',
        ]),
        message: z.string(),
      }),
    }),
  ]),
  executor: async (input, ctx) => {
    const persistenceRoot = ctx.persistenceRoot ?? ctx.repoRoot;
    return updatePlan({
      persistenceRoot,
      sessionId: input.sessionId,
      baseHash: input.baseHash,
      stepId: input.stepId,
      patch: input.patch,
    });
  },
};
