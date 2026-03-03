import type { FlowMode } from '../../../core/types/index.js';

export function resolveRunMode(raw: unknown): FlowMode | undefined {
  const value = String(raw || 'patch');
  if (value === 'patch' || value === 'review' || value === 'debug' || value === 'research') {
    return value;
  }
  return undefined;
}
