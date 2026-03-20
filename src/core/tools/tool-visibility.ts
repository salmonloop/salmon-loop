import { Phase, type ExecutionPhase } from '../types/runtime.js';

import type { ToolSpec } from './types.js';

export type ToolVisibilityRuntime = {
  plan?: { sessionId: string; planPathHint: string };
};

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
  return params.tools;
}
