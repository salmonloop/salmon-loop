import type { FlowMode } from '../types/runtime.js';

export type FlowModePublicMetadata = {
  publicTitle: string;
  acpName: string;
  description: string;
};

export const FLOW_MODE_PUBLIC_METADATA: Record<FlowMode, FlowModePublicMetadata> = {
  autopilot: {
    publicTitle: 'Autopilot',
    acpName: 'Autopilot',
    description: 'Let the agent decide which actions and tools to use.',
  },
  patch: {
    publicTitle: 'Patch code',
    acpName: 'Patch',
    description: 'Apply code changes with verification.',
  },
  review: {
    publicTitle: 'Review code',
    acpName: 'Review',
    description: 'Inspect code and report findings without mutating files.',
  },
  debug: {
    publicTitle: 'Debug issue',
    acpName: 'Debug',
    description: 'Investigate issues and make targeted fixes when needed.',
  },
  research: {
    publicTitle: 'Research request',
    acpName: 'Research',
    description: 'Explore the codebase and summarize relevant findings.',
  },
  answer: {
    publicTitle: 'Answer question',
    acpName: 'Answer',
    description: 'Answer questions directly without editing files.',
  },
};
