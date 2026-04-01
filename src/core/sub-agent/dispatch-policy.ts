import type { ExecutionPhase } from '../tools/types.js';
import { Phase } from '../types/runtime.js';

const READ_ONLY_MODEL_PHASE_SET = new Set<ExecutionPhase>([
  Phase.EXPLORE,
  Phase.PLAN,
  Phase.PATCH,
]);

/**
 * Read-only model phases in which sub-agent dispatch must never cause workspace mutation.
 */
export function isReadOnlyModelPhase(phase: ExecutionPhase | undefined): boolean {
  return phase !== undefined && READ_ONLY_MODEL_PHASE_SET.has(phase);
}

/**
 * In read-only model phases, sub-agent execution must run in dry-run mode regardless of parent value.
 */
export function resolveSubAgentDryRun(
  parentDryRun: boolean,
  phase: ExecutionPhase | undefined,
): boolean {
  if (isReadOnlyModelPhase(phase)) {
    return true;
  }
  return parentDryRun;
}
