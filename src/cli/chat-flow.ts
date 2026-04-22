import { resolveExecutionProfile } from '../core/runtime/execution-profile.js';
import type { FlowMode } from '../core/types/execution.js';
import type { CheckpointStrategy } from '../core/types/loop.js';

export function resolveActiveChatFlowMode(
  sessionFlowMode: FlowMode | undefined,
  defaultFlowMode: FlowMode | undefined,
): FlowMode {
  return sessionFlowMode ?? defaultFlowMode ?? 'autopilot';
}

export function resolveChatCheckpointStrategy(
  flowMode: FlowMode,
  configured: CheckpointStrategy | undefined,
): CheckpointStrategy {
  return resolveExecutionProfile(flowMode).readOnly ? 'direct' : configured ?? 'worktree';
}
