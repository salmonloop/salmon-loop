import { describe, expect, test, mock } from 'bun:test';

const mockAllows = mock((from, to) => true);

mock.module('../../../../../src/core/interaction/model/transition-policy.js', () => {
  return {
    createTaskTransitionPolicy: () => ({ allows: mockAllows }),
  };
});

const { isTerminalTaskState, canTransitionTaskState } = await import(
  '../../../../../src/core/interaction/model/task-state.js'
);

describe('task-state', () => {
  describe('isTerminalTaskState', () => {
    test('returns true for terminal states', () => {
      expect(isTerminalTaskState('completed')).toBe(true);
      expect(isTerminalTaskState('failed')).toBe(true);
      expect(isTerminalTaskState('cancelled')).toBe(true);
    });

    test('returns false for non-terminal states', () => {
      expect(isTerminalTaskState('accepted')).toBe(false);
      expect(isTerminalTaskState('running')).toBe(false);
      expect(isTerminalTaskState('awaiting_input')).toBe(false);
      expect(isTerminalTaskState('streaming')).toBe(false);
    });
  });

  describe('canTransitionTaskState', () => {
    test('delegates to transitionPolicy.allows and returns true', () => {
      mockAllows.mockReturnValueOnce(true);

      const result = canTransitionTaskState('accepted', 'running');

      expect(result).toBe(true);
      expect(mockAllows).toHaveBeenCalledWith('accepted', 'running');
    });

    test('delegates to transitionPolicy.allows and returns false', () => {
      mockAllows.mockReturnValueOnce(false);

      const result = canTransitionTaskState('running', 'completed');

      expect(result).toBe(false);
      expect(mockAllows).toHaveBeenCalledWith('running', 'completed');
    });
  });
});
