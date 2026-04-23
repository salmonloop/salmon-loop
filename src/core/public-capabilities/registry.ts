import { FLOW_MODES } from '../types/flow-mode.js';
import type { FlowMode } from '../types/runtime.js';

import { FLOW_MODE_PUBLIC_METADATA } from './flow-mode-metadata.js';
import type { PublicCapability, PublicCapabilitySurfaces } from './types.js';

function getFlowModeSurfaces(mode: FlowMode): PublicCapabilitySurfaces {
  if (mode === 'autopilot') {
    return {
      a2a: true,
      acp: true,
    };
  }

  return {
    a2a: false,
    acp: true,
  };
}

export function buildPublicCapabilityRegistry(): PublicCapability[] {
  return FLOW_MODES.map((mode) => ({
    id: mode,
    kind: 'flow_mode',
    target: mode,
    title: FLOW_MODE_PUBLIC_METADATA[mode].publicTitle,
    description: FLOW_MODE_PUBLIC_METADATA[mode].description,
    surfaces: getFlowModeSurfaces(mode),
    reachability: 'reachable',
  }));
}
