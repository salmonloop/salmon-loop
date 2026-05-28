import type { AgentSkill } from '@a2a-js/sdk';

import { FLOW_MODE_PUBLIC_METADATA } from './flow-mode-metadata.js';
import { buildPublicCapabilityRegistry } from './registry.js';
import type {
  FlowModePublicCapability,
  PublicCapability,
  PublicCapabilitySurface,
} from './types.js';

export interface AcpPublicMode {
  id: FlowModePublicCapability['target'];
  name: string;
  description: string;
}

export interface A2APublicSkill {
  id: string;
  title: string;
  description: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
  security?: AgentSkill['security'];
}

export function selectPublicCapabilitiesForSurface(
  surface: PublicCapabilitySurface,
  entries: PublicCapability[] = buildPublicCapabilityRegistry(),
): PublicCapability[] {
  return entries.filter((entry) => entry.reachability === 'reachable' && entry.surfaces[surface]);
}

function isFlowModeCapability(entry: PublicCapability): entry is FlowModePublicCapability {
  return entry.kind === 'flow_mode';
}

export function toAcpPublicModes(
  entries: PublicCapability[] = buildPublicCapabilityRegistry(),
): AcpPublicMode[] {
  return selectPublicCapabilitiesForSurface('acp', entries)
    .filter(isFlowModeCapability)
    .map((entry) => ({
      id: entry.target,
      name: FLOW_MODE_PUBLIC_METADATA[entry.target].acpName,
      description: entry.description,
    }));
}

export function toA2APublicSkills(
  entries: PublicCapability[] = buildPublicCapabilityRegistry(),
): A2APublicSkill[] {
  return selectPublicCapabilitiesForSurface('a2a', entries).map((entry) => ({
    id: entry.id,
    title: entry.title,
    description: entry.description,
    tags: entry.tags,
    examples: entry.examples,
    inputModes: entry.inputModes,
    outputModes: entry.outputModes,
    security: entry.security,
  }));
}
