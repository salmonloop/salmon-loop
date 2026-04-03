import type { ResumeRepairStage } from '../types.js';

function hasFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export const relinkBoundaryAndTailStage: ResumeRepairStage = async (state) => {
  const meta = state.session.meta;
  if (!meta.id || !meta.name || !hasFiniteTimestamp(meta.createdAt)) {
    state.contractViolations.push({
      code: 'MALFORMED_BOUNDARY_METADATA',
      message: 'Archive metadata failed boundary validation.',
    });
    return;
  }

  const invalidMessage = state.session.messages.some(
    (message) => !hasFiniteTimestamp(message.timestamp) || !message.id,
  );
  if (invalidMessage) {
    state.contractViolations.push({
      code: 'MALFORMED_BOUNDARY_METADATA',
      message: 'Recovered messages contain invalid boundary metadata.',
    });
  }
};
