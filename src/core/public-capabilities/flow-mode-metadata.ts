import type { FlowMode } from '../types/runtime.js';

export type FlowModePublicMetadata = {
  publicTitle: string;
  a2aTitle: string;
  acpName: string;
  description: string;
};

export const FLOW_MODE_PUBLIC_METADATA: Record<FlowMode, FlowModePublicMetadata> = {
  autopilot: {
    publicTitle: 'Autopilot',
    a2aTitle: 'Autopilot',
    acpName: 'Autopilot',
    description: 'Let the agent decide which actions and tools to use.',
  },
  patch: {
    publicTitle: 'Patch code',
    a2aTitle: 'Patch code',
    acpName: 'Patch',
    description: 'Apply code changes with verification.',
  },
  review: {
    publicTitle: 'Review code',
    a2aTitle: 'Review code',
    acpName: 'Review',
    description: 'Inspect code and report findings without mutating files.',
  },
  debug: {
    publicTitle: 'Debug issue',
    a2aTitle: 'Debug issue',
    acpName: 'Debug',
    description: 'Investigate issues and make targeted fixes when needed.',
  },
  research: {
    publicTitle: 'Research request',
    a2aTitle: 'Research request',
    acpName: 'Research',
    description: 'Explore the codebase and summarize relevant findings.',
  },
  answer: {
    publicTitle: 'Answer question',
    a2aTitle: 'Answer question',
    acpName: 'Answer',
    description: 'Answer questions directly without editing files.',
  },
};
