import { describe, expect, test } from 'bun:test';

import {
  isTerminalTaskState,
  canTransitionTaskState,
} from '../../../../../src/core/interaction/model/task-state.js';

describe('task-state', () => {
  describe('isTerminalTaskState', () => {
    test('returns true for terminal states', () => {
      expect(isTerminalTaskState('completed')).toBe(true);
      expect(isTerminalTaskState('failed')).toBe(true);
      expect(isTerminalTaskState('cancelled')).toBe(true);
    });

    test('returns false for non-terminal states', () => {
      const nonTerminalStates = ['accepted', 'running', 'awaiting_input', 'streaming'];
      nonTerminalStates.forEach((state) => {
        expect(isTerminalTaskState(state as any)).toBe(false);
      });
    });
  });

  describe('canTransitionTaskState', () => {
    test('delegates to transition policy', () => {
      // Integration style testing due to static policy initialization during module load
      expect(canTransitionTaskState('accepted', 'running')).toBe(true);
      expect(canTransitionTaskState('completed', 'running')).toBe(false);
    });
  });
});
