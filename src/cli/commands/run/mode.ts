import type { FlowMode } from '../../../core/types/execution.js';

export function resolveRunMode(raw: unknown): FlowMode | undefined {
  const value = String(raw || 'patch');
  if (
    value === 'patch' ||
    value === 'review' ||
    value === 'debug' ||
    value === 'research' ||
    value === 'autopilot'
  ) {
    return value;
  }
  return undefined;
}
