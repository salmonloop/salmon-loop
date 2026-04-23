import type { FlowMode } from './execution.js';

export const FLOW_MODES = ['patch', 'review', 'debug', 'research', 'answer', 'autopilot'] as const;

export function parseFlowMode(raw: unknown): FlowMode | undefined {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return FLOW_MODES.includes(value as FlowMode) ? (value as FlowMode) : undefined;
}
