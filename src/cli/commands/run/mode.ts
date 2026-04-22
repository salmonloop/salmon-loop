import type { FlowMode } from '../../../core/types/execution.js';
import { parseFlowMode } from '../../../core/types/flow-mode.js';

export function resolveRunMode(raw: unknown): FlowMode | undefined {
  return parseFlowMode(raw || 'autopilot');
}
