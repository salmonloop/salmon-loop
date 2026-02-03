import { describe, it, expect } from 'vitest';

import { uiReducer } from '../../../../../src/cli/ui/store/reducer.js';
import { initialState } from '../../../../../src/cli/ui/store/reducer.js';
import { UIState } from '../../../../../src/cli/ui/store/types.js';

describe('TUI Confirmation Logic (High-Risk Intercept)', () => {
  it('should initialize with no pending confirmation', () => {
    expect(initialState.pendingConfirmation).toBeUndefined();
  });

  it('should set confirmation state correctly', () => {
    const confirmation: UIState['pendingConfirmation'] = {
      message: 'Confirm restore?',
      challenge: 'a1b2c3',
      command: '/snapshot',
      args: { subCommand: 'restore', hash: 'a1b2c3d4e5f6' },
    };

    const newState = uiReducer(initialState, {
      type: 'SET_CONFIRMATION',
      payload: confirmation,
    });

    expect(newState.pendingConfirmation).toEqual(confirmation);
    expect(newState.pendingConfirmation?.challenge).toBe('a1b2c3');
  });

  it('should clear confirmation state atomically', () => {
    const stateWithConfirmation: UIState = {
      ...initialState,
      pendingConfirmation: {
        message: '...',
        challenge: '123456',
        command: '...',
        args: {},
      },
    };

    const newState = uiReducer(stateWithConfirmation, {
      type: 'CLEAR_CONFIRMATION',
    });
    expect(newState.pendingConfirmation).toBeUndefined();
  });
});
