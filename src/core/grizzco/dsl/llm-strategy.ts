import type { LLM } from '../../types/index.js';
import { Phase, type ExecutionPhase } from '../../types/index.js';

import { DecisionEngine, type DslContext, PlanBuilder } from './DecisionEngine.js';

export interface LlmToolCallingPolicy {
  enabled: boolean;
  maxRounds: number;
}

interface LlmPolicyAction {
  type: 'SET_TOOL_CALLING_POLICY';
  params: LlmToolCallingPolicy;
}

function defaultMaxRoundsForPhase(phase: ExecutionPhase): number {
  // Explore needs more rounds to navigate the codebase
  if (phase === Phase.EXPLORE) return 8;
  if (phase === Phase.PLAN) return 4;
  if (phase === Phase.PATCH) return 4;
  return 4;
}

export function resolveLlmToolCallingPolicy(phase: ExecutionPhase, llm: LLM): LlmToolCallingPolicy {
  const caps = llm.getCapabilities?.();
  const maxRounds = defaultMaxRoundsForPhase(phase);

  // Grizzco DSL engine is transaction-shaped; for LLM policies we inject a minimal context and keep all
  // decisions inside ctx.data to avoid coupling to file/operation semantics.
  const ctx: DslContext = {
    repoRoot: '',
    file: {
      path: '',
      status: 0 as any,
      isBinary: false,
      isSymlink: false,
      isIgnored: false,
      hasConflict: false,
      size: 0,
    },
    operation: {
      type: 0 as any,
      path: '',
    },
    options: {
      force: false,
      allowMM: false,
      safeMode: true,
      rejectDir: '',
      dryRun: true,
      maxFileSize: 0,
    },
    snapshot: {
      exists: true,
      id: 'llm-policy',
      timestamp: 0,
      path: '',
    },
    runtime: {
      needsRollback: false,
    },
    data: {
      llm_tool_calling_capable: Boolean(caps?.toolCalling),
      llm_tool_calling_max_rounds: maxRounds,
      phase,
    },
  };

  const planBuilder = new PlanBuilder();
  const engine = new DecisionEngine(ctx, planBuilder);

  const result = engine
    .phase('LLM Tool Calling Policy')
    .requireData('llm_tool_calling_capable')
    .requireData('llm_tool_calling_max_rounds')
    .when(
      (c) => Boolean(c.data?.llm_tool_calling_capable),
      (p) =>
        p.addAction('SET_TOOL_CALLING_POLICY', {
          enabled: true,
          maxRounds,
        } satisfies LlmToolCallingPolicy),
    )
    .unless(
      (c) => Boolean(c.data?.llm_tool_calling_capable),
      (p) =>
        p.addAction('SET_TOOL_CALLING_POLICY', {
          enabled: false,
          maxRounds,
        } satisfies LlmToolCallingPolicy),
    )
    .build();

  if (result.type !== 'PLAN') {
    return { enabled: false, maxRounds };
  }

  const actions = result.plan.actions as LlmPolicyAction[];
  const lastPolicy = [...actions].reverse().find((a) => a.type === 'SET_TOOL_CALLING_POLICY');
  return lastPolicy?.params || { enabled: false, maxRounds };
}
