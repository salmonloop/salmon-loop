import { normalizeSessionArtifactState } from '../../artifact-state.js';
import { normalizeToolResultReplacementState } from '../../replacement-state.js';
import type { ResumeRepairStage } from '../types.js';

export const reattachRuntimeStateStage: ResumeRepairStage = async (state) => {
  state.session.meta.artifactState = normalizeSessionArtifactState(
    state.session.meta.artifactState,
  );
  state.replacementState = normalizeToolResultReplacementState(state.replacementState);
  state.session.meta.replacementState = state.replacementState;
};
