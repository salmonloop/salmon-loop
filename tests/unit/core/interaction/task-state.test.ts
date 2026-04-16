import { describe, expect, test } from 'bun:test';

import { isTerminalTaskState, canTransitionTaskState } from '../../../../src/core/interaction/model/task-state.js';

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
    test('allows valid transitions according to policy', () => {
      expect(canTransitionTaskState('accepted', 'running')).toBe(true);
      expect(canTransitionTaskState('running', 'completed')).toBe(true);
    });

    test('disallows invalid transitions according to policy', () => {
      expect(canTransitionTaskState('accepted', 'completed')).toBe(false);
      expect(canTransitionTaskState('completed', 'running')).toBe(false);
    });
  });
});
