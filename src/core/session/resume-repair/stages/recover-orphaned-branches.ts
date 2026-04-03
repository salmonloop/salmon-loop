import type { ResumeRepairStage } from '../types.js';

export const recoverOrphanedBranchesStage: ResumeRepairStage = async (state) => {
  if (state.session.iterations.length > state.session.meta.totalIterations) {
    state.session.meta.totalIterations = state.session.iterations.length;
    state.repairActions.push({
      code: 'RECOVERED_ITERATION_COUNT',
      detail: 'Normalized stale totalIterations from recovered iteration list.',
    });
  }
};
