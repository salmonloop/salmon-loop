import type { FlowMode } from '../types/runtime.js';

export type PublicCapabilityKind = 'flow_mode' | 'workflow' | 'local_skill';
export type PublicCapabilitySurface = 'a2a' | 'acp';
export type PublicCapabilityReachability = 'reachable' | 'latent' | 'disabled';

export type PublicCapabilitySurfaces = Record<PublicCapabilitySurface, boolean>;

interface PublicCapabilityBase {
  id: string;
  title: string;
  description: string;
  surfaces: PublicCapabilitySurfaces;
  reachability: PublicCapabilityReachability;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface FlowModePublicCapability extends PublicCapabilityBase {
  kind: 'flow_mode';
  target: FlowMode;
}

export interface WorkflowPublicCapability extends PublicCapabilityBase {
  kind: 'workflow';
  target: string;
}

export interface LocalSkillPublicCapability extends PublicCapabilityBase {
  kind: 'local_skill';
  target: string;
}

export type PublicCapability =
  | FlowModePublicCapability
  | WorkflowPublicCapability
  | LocalSkillPublicCapability;
