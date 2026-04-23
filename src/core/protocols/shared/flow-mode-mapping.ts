import { FLOW_MODES, parseFlowMode } from '../../types/flow-mode.js';
import type { FlowMode } from '../../types/runtime.js';
import { FLOW_MODE_PUBLIC_METADATA } from '../../public-capabilities/flow-mode-metadata.js';

export const SUPPORTED_PROTOCOL_FLOW_MODES = FLOW_MODES;

export function parseAcpFlowMode(value: unknown): FlowMode | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'interactive' || normalized === 'yolo') {
    return 'autopilot';
  }
  return parseFlowMode(normalized);
}

export function parseA2ASkillFlowMode(value: unknown): FlowMode | undefined {
  return parseFlowMode(value);
}

export function buildA2AFlowSkills(): Array<{ id: FlowMode; title: string }> {
  return SUPPORTED_PROTOCOL_FLOW_MODES.map((mode) => ({
    id: mode,
    title: FLOW_MODE_PUBLIC_METADATA[mode].a2aTitle,
  }));
}
