import type { ResumeRepairStage } from '../types.js';

function hasFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export const relinkBoundaryAndTailStage: ResumeRepairStage = async (state) => {
  const meta = state.session.meta;
  if (!meta.id || !meta.name || !hasFiniteTimestamp(meta.createdAt) || !hasFiniteTimestamp(meta.updatedAt)) {
    state.contractViolations.push({
      code: 'MALFORMED_SESSION_BOUNDARY_METADATA',
      message: 'Archive metadata failed boundary validation.',
    });
    return;
  }

  const invalidMessage = state.session.messages.some(
    (message) => !hasFiniteTimestamp(message.timestamp) || !message.id,
  );
  if (invalidMessage) {
    state.contractViolations.push({
      code: 'MALFORMED_MESSAGE_BOUNDARY_METADATA',
      message: 'Recovered messages contain invalid boundary metadata.',
    });
    return;
  }

  const invalidIteration = state.session.iterations.some(
    (iteration) =>
      typeof iteration.id !== 'string' ||
      !iteration.id ||
      !Number.isInteger(iteration.attempt) ||
      iteration.attempt <= 0 ||
      typeof iteration.contextSummary !== 'string',
  );
  if (invalidIteration) {
    state.contractViolations.push({
      code: 'MALFORMED_TAIL_ITERATION_METADATA',
      message: 'Recovered iterations contain invalid tail metadata.',
    });
  }
};
