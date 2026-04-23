import { Phase, type ExecutionPhase } from '../types/runtime.js';

import type { ToolRuntimeCtx, ToolSpec } from './types.js';

export type ToolVisibilityRuntime = {
  plan?: { sessionId: string; planPathHint: string };
};

export interface VisibleToolstackLike {
  registry: { listAll(): ToolSpec[] };
  policy: {
    decide(
      phase: ExecutionPhase,
      spec: ToolSpec,
      ctx: Pick<ToolRuntimeCtx, 'worktreeRoot' | 'flowMode'>,
    ): { allowed: boolean };
  };
}

const PLAN_RUNTIME_TOOL_NAMES = new Set(['plan.read', 'plan.update']);
const PATCH_VISIBLE_TOOL_NAMES = new Set(['fs.read', 'code.search']);

function isPhaseAllowed(tool: ToolSpec, phase: ExecutionPhase): boolean {
  return Array.isArray(tool.allowedPhases) && tool.allowedPhases.includes(phase);
}

export function resolvePlanVisibleTools(
  tools: ToolSpec[],
  runtime?: ToolVisibilityRuntime,
): ToolSpec[] {
  const hasRuntimePlan = Boolean(runtime?.plan);

  return tools.filter((tool) => {
    if (!isPhaseAllowed(tool, Phase.PLAN)) return false;
    if (!tool.name.startsWith('plan.')) return true;
    if (!hasRuntimePlan) return false;
    return PLAN_RUNTIME_TOOL_NAMES.has(tool.name);
  });
}

export function resolvePatchVisibleTools(tools: ToolSpec[]): ToolSpec[] {
  return tools.filter(
    (tool) => isPhaseAllowed(tool, Phase.PATCH) && PATCH_VISIBLE_TOOL_NAMES.has(tool.name),
  );
}

export function resolveAutopilotVisibleTools(
  tools: ToolSpec[],
  runtime?: ToolVisibilityRuntime,
): ToolSpec[] {
  const hasRuntimePlan = Boolean(runtime?.plan);

  return tools.filter((tool) => {
    if (!isPhaseAllowed(tool, Phase.AUTOPILOT)) return false;
    if (!tool.name.startsWith('plan.')) return true;
    if (!hasRuntimePlan) return false;
    return PLAN_RUNTIME_TOOL_NAMES.has(tool.name);
  });
}

export function resolvePhaseVisibleTools(params: {
  phase: ExecutionPhase;
  tools: ToolSpec[];
  runtime?: ToolVisibilityRuntime;
}): ToolSpec[] {
  if (params.phase === Phase.PLAN) {
    return resolvePlanVisibleTools(params.tools, params.runtime);
  }
  if (params.phase === Phase.PATCH) {
    return resolvePatchVisibleTools(params.tools);
  }
  if (params.phase === Phase.AUTOPILOT) {
    return resolveAutopilotVisibleTools(params.tools, params.runtime);
  }
  return params.tools;
}

export function resolveVisibleToolSpecs(params: {
  phase: ExecutionPhase;
  toolstack?: VisibleToolstackLike;
  worktreeRoot?: ToolRuntimeCtx['worktreeRoot'];
  flowMode?: ToolRuntimeCtx['flowMode'];
  runtime?: ToolVisibilityRuntime;
}): ToolSpec[] {
  if (!params.toolstack) return [];

  const allowedSpecs = params.toolstack.registry.listAll().filter((spec) =>
    params.toolstack!.policy.decide(params.phase, spec, {
      worktreeRoot: params.worktreeRoot,
      flowMode: params.flowMode,
    }).allowed,
  );

  return resolvePhaseVisibleTools({
    phase: params.phase,
    tools: allowedSpecs,
    runtime: params.runtime,
  });
}

export function resolveVisibleToolNames(params: {
  phase: ExecutionPhase;
  toolstack?: VisibleToolstackLike;
  worktreeRoot?: ToolRuntimeCtx['worktreeRoot'];
  flowMode?: ToolRuntimeCtx['flowMode'];
  runtime?: ToolVisibilityRuntime;
}): string[] {
  return resolveVisibleToolSpecs(params).map((spec) => spec.name);
}
