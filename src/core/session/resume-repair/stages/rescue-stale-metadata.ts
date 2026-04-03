import type { ResumeRepairStage } from '../types.js';

export const rescueStaleMetadataStage: ResumeRepairStage = async (state, context) => {
  if (!state.session.meta.name.trim()) {
    state.session.meta.name = `Recovered ${state.session.meta.id}`;
    state.repairActions.push({
      code: 'RESCUED_EMPTY_NAME',
      detail: 'Recovered missing session name from archive metadata.',
    });
  }

  if (state.session.meta.updatedAt < state.session.meta.createdAt) {
    state.session.meta.updatedAt = context.now();
    state.repairActions.push({
      code: 'RESCUED_UPDATED_AT',
      detail: 'Adjusted stale updatedAt to a valid timestamp.',
    });
  }
};
