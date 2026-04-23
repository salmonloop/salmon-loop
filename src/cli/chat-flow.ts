import {
  resolveExecutionProfile,
  type CheckpointStrategy,
  type FlowMode,
} from '../core/facades/cli-chat.js';

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
  const profile = resolveExecutionProfile(flowMode);
  return profile.readOnly
    ? 'direct'
    : (configured ?? profile.defaultCheckpointStrategy ?? 'worktree');
}
