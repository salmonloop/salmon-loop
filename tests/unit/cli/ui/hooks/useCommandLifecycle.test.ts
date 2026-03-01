import { act, renderHook } from '@testing-library/react';

import { useCommandLifecycle } from '../../../../../src/cli/ui/hooks/useCommandLifecycle.js';
import { runOnlyPendingTimers } from '../../../../helpers/bun-timers.js';

const hoisted = (() => ({
  inputHandler: null as ((input: string, key: any) => void) | null,
  dispatch: mock(),
}))();

mock.module('ink', () => ({
  useInput: (handler: (input: string, key: any) => void) => {
    hoisted.inputHandler = handler;
  },
}));

mock.module('../../../../../src/cli/ui/store/context.js', () => ({
  useUIStore: () => ({ dispatch: hoisted.dispatch }),
}));

describe('useCommandLifecycle', () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    hoisted.inputHandler = null;
    hoisted.dispatch.mockClear();
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {
      /* ignore */
    });
    useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      runOnlyPendingTimers();
    });
    useRealTimers();
    const hasActWarning = consoleErrorSpy.mock.calls.some((call: any[]) =>
      call.some((arg: any) => typeof arg === 'string' && arg.includes('not wrapped in act')),
    );
    expect(hasActWarning).toBe(false);
    mock.restore();
  });

  it('splat interrupts on Ctrl+C while running', () => {
    const onExit = mock();
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
    const onExit = mock();
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
    const onExit = mock();
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
