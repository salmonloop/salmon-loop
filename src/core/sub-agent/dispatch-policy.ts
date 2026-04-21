import { resolveExecutionProfile } from '../runtime/execution-profile.js';
import type { ExecutionPhase } from '../tools/types.js';
import type { FlowMode } from '../types/runtime.js';
import { Phase } from '../types/runtime.js';

const READ_ONLY_MODEL_PHASE_SET = new Set<ExecutionPhase>([Phase.EXPLORE, Phase.PLAN, Phase.PATCH]);

/**
 * Read-only model phases in which sub-agent dispatch must never cause workspace mutation.
 */
export function isReadOnlyModelPhase(phase: ExecutionPhase | undefined): boolean {
  return phase !== undefined && READ_ONLY_MODEL_PHASE_SET.has(phase);
}

export interface SubAgentDispatchContext {
  flowMode?: FlowMode;
  phase?: ExecutionPhase;
}

export function isReadOnlySubAgentContext({
  flowMode,
  phase,
}: SubAgentDispatchContext): boolean {
  if (!flowMode) {
    return isReadOnlyModelPhase(phase);
  }

  const profile = resolveExecutionProfile(flowMode);
  if (profile.driver === 'agent') {
    return false;
  }

  return isReadOnlyModelPhase(phase);
}

/**
 * In read-only model phases, sub-agent execution must run in dry-run mode regardless of parent value.
 */
export function resolveSubAgentDryRun({
  parentDryRun,
  flowMode,
  phase,
}: SubAgentDispatchContext & {
  parentDryRun: boolean;
}): boolean {
  if (isReadOnlySubAgentContext({ flowMode, phase })) {
    return true;
  }
  return parentDryRun;
}
