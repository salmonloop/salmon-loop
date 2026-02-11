import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';

import { useCommandLifecycle } from '../../../../../src/cli/ui/hooks/useCommandLifecycle.js';

const hoisted = vi.hoisted(() => ({
  inputHandler: null as ((input: string, key: any) => void) | null,
  dispatch: vi.fn(),
}));

vi.mock('ink', () => ({
  useInput: (handler: (input: string, key: any) => void) => {
    hoisted.inputHandler = handler;
  },
}));

vi.mock('../../../../../src/cli/ui/store/context.js', () => ({
  useUIStore: () => ({ dispatch: hoisted.dispatch }),
}));

describe('useCommandLifecycle', () => {
  beforeEach(() => {
    hoisted.inputHandler = null;
    hoisted.dispatch.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('splat interrupts on Ctrl+C while running', () => {
    const onExit = vi.fn();
    renderHook(() => useCommandLifecycle('running', onExit));

    expect(hoisted.inputHandler).not.toBeNull();

    act(() => {
      hoisted.inputHandler?.('c', { ctrl: true });
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'INTERRUPT_STREAM' }),
    );
    expect(hoisted.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_STATUS_BANNER' }),
    );
    expect(onExit).not.toHaveBeenCalled();
  });

  it('exits on second Ctrl+C', () => {
    const onExit = vi.fn();
    renderHook(() => useCommandLifecycle('running', onExit));

    act(() => {
      hoisted.inputHandler?.('c', { ctrl: true });
    });

    act(() => {
      hoisted.inputHandler?.('c', { ctrl: true });
    });

    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('splat interrupts on double Escape while running', () => {
    const onExit = vi.fn();
    renderHook(() => useCommandLifecycle('running', onExit));

    act(() => {
      hoisted.inputHandler?.('', { escape: true });
      hoisted.inputHandler?.('', { escape: true });
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'INTERRUPT_STREAM' }),
    );
    expect(hoisted.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_STATUS_BANNER' }),
    );
    expect(onExit).not.toHaveBeenCalled();
  });
});
