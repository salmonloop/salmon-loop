import type { PermissionMode } from '../config/types.js';
import type { CheckpointStrategy } from '../types/loop.js';
import { Phase, type ExecutionPhase, type FlowMode } from '../types/runtime.js';

export type DriverKind = 'recipe' | 'agent';
export type FailurePolicy = 'rollback' | 'preserve';
export type VerifyPolicy =
  | 'never'
  | 'on_explicit_request'
  | 'required_before_success_if_mutated';

export interface ExecutionProfile {
  mode: FlowMode;
  driver: DriverKind;
  readOnly: boolean;
  defaultPermissionMode?: PermissionMode;
  defaultCheckpointStrategy?: CheckpointStrategy;
  ignoreDirtyPreflight: boolean;
  failurePolicy: FailurePolicy;
  verifyPolicy: VerifyPolicy;
  entryPhase: ExecutionPhase;
}

const RECIPE_ENTRY_PHASE: ExecutionPhase = Phase.PLAN;

const RECIPE_PROFILES: Record<Exclude<FlowMode, 'autopilot'>, ExecutionProfile> = {
  patch: {
    mode: 'patch',
    driver: 'recipe',
    readOnly: false,
    ignoreDirtyPreflight: false,
    failurePolicy: 'rollback',
    verifyPolicy: 'required_before_success_if_mutated',
    entryPhase: RECIPE_ENTRY_PHASE,
  },
  review: {
    mode: 'review',
    driver: 'recipe',
    readOnly: true,
    ignoreDirtyPreflight: true,
    failurePolicy: 'rollback',
    verifyPolicy: 'never',
    entryPhase: RECIPE_ENTRY_PHASE,
  },
  debug: {
    mode: 'debug',
    driver: 'recipe',
    readOnly: false,
    ignoreDirtyPreflight: false,
    failurePolicy: 'rollback',
    verifyPolicy: 'required_before_success_if_mutated',
    entryPhase: RECIPE_ENTRY_PHASE,
  },
  research: {
    mode: 'research',
    driver: 'recipe',
    readOnly: true,
    ignoreDirtyPreflight: true,
    failurePolicy: 'rollback',
    verifyPolicy: 'never',
    entryPhase: RECIPE_ENTRY_PHASE,
  },
  answer: {
    mode: 'answer',
    driver: 'recipe',
    readOnly: true,
    ignoreDirtyPreflight: true,
    failurePolicy: 'rollback',
    verifyPolicy: 'never',
    entryPhase: RECIPE_ENTRY_PHASE,
  },
};

const AUTOPILOT_PROFILE: ExecutionProfile = {
  mode: 'autopilot',
  driver: 'agent',
  readOnly: false,
  defaultPermissionMode: 'yolo',
  defaultCheckpointStrategy: 'direct',
  ignoreDirtyPreflight: true,
  failurePolicy: 'preserve',
  verifyPolicy: 'required_before_success_if_mutated',
  entryPhase: Phase.AUTOPILOT,
};

export function resolveExecutionProfile(mode: FlowMode): ExecutionProfile {
  if (mode === 'autopilot') {
    return AUTOPILOT_PROFILE;
  }
  return RECIPE_PROFILES[mode];
}
