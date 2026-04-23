import { FLOW_MODES } from '../types/flow-mode.js';
import type { FlowMode } from '../types/runtime.js';

import type { PublicCapability, PublicCapabilitySurfaces } from './types.js';

const FLOW_MODE_METADATA: Record<FlowMode, { title: string; description: string }> = {
  autopilot: {
    title: 'Autopilot',
    description: 'Autonomously inspect, edit, and verify work.',
  },
  patch: {
    title: 'Patch code',
    description: 'Modify repository code directly.',
  },
  review: {
    title: 'Review code',
    description: 'Inspect code and report findings without editing.',
  },
  debug: {
    title: 'Debug issue',
    description: 'Investigate failures and apply targeted fixes.',
  },
  research: {
    title: 'Research request',
    description: 'Explore the codebase and synthesize findings.',
  },
  answer: {
    title: 'Answer question',
    description: 'Respond directly without repo mutation by default.',
  },
};

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
    title: FLOW_MODE_METADATA[mode].title,
    description: FLOW_MODE_METADATA[mode].description,
    surfaces: getFlowModeSurfaces(mode),
    reachability: 'reachable',
  }));
}
