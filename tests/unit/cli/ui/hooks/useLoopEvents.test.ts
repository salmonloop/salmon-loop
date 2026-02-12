import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';

import { useLoopEvents } from '../../../../../src/cli/ui/hooks/useLoopEvents.js';

const hoisted = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock('../../../../../src/cli/ui/store/context.js', () => ({
  useUIStore: () => ({ dispatch: hoisted.dispatch }),
}));

describe('useLoopEvents', () => {
  beforeEach(() => {
    hoisted.dispatch.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates llm.stream.delta as APPEND_LLM_STREAM in chat mode', () => {
    const onStart = vi.fn();
    const signal = new AbortController().signal;
    const { result } = renderHook(() => useLoopEvents('chat', onStart, signal));

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'llm.stream.delta',
        streamId: 'stream-chat-1',
        content: 'partial token',
        timestamp: new Date('2026-02-06T23:00:00.000Z'),
      });
    });

    // Advance timers to trigger the 100ms throttle flush
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith({
      type: 'APPEND_LLM_STREAM',
      payload: {
        id: 'stream-chat-1',
        delta: 'partial token',
        timestamp: new Date('2026-02-06T23:00:00.000Z'),
      },
    });
  });

  it('registers run callback and routes stream delta through APPEND_LLM_STREAM', () => {
    const signal = new AbortController().signal;
    let capturedHandler: ((event: any) => void) | undefined;
    const onStart = vi.fn((handler: (event: any) => void) => {
      capturedHandler = handler;
    });

    renderHook(() => useLoopEvents('run', onStart, signal));

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(capturedHandler).toBeDefined();

    act(() => {
      capturedHandler?.({
        type: 'llm.stream.delta',
        streamId: 'stream-run-1',
        content: 'hello',
        timestamp: new Date('2026-02-06T23:01:00.000Z'),
      });
    });

    // Advance timers to trigger the 100ms throttle flush
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith({
      type: 'APPEND_LLM_STREAM',
      payload: {
        id: 'stream-run-1',
        delta: 'hello',
        timestamp: new Date('2026-02-06T23:01:00.000Z'),
      },
    });
  });

  it('dispatches SET_STATUS_BANNER for ui.status set events', () => {
    const onStart = vi.fn();
    const signal = new AbortController().signal;
    const { result } = renderHook(() => useLoopEvents('chat', onStart, signal));

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'ui.status',
        action: 'set',
        face: '(,,-`_●-)',
        label: 'cleanup',
        timestamp: new Date('2026-02-06T23:02:00.000Z'),
      });
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith({
      type: 'SET_STATUS_BANNER',
      payload: { face: '(,,-`_●-)', label: 'cleanup', source: 'runtime' },
    });
  });

  it('dispatches CLEAR_STATUS_BANNER for ui.status clear events', () => {
    const onStart = vi.fn();
    const signal = new AbortController().signal;
    const { result } = renderHook(() => useLoopEvents('chat', onStart, signal));

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'ui.status',
        action: 'clear',
        timestamp: new Date('2026-02-06T23:03:00.000Z'),
      });
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith({ type: 'CLEAR_STATUS_BANNER' });
  });

  it('dispatches a warning message for retry events', () => {
    const onStart = vi.fn();
    const signal = new AbortController().signal;
    const { result } = renderHook(() => useLoopEvents('chat', onStart, signal));

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'retry',
        fromAttempt: 1,
        toAttempt: 2,
        reason: 'Patch generation failed',
        failedFiles: [],
        timestamp: new Date('2026-02-06T23:04:00.000Z'),
      });
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_MESSAGE',
        payload: expect.objectContaining({
          type: 'warning',
          content: expect.stringContaining('Retrying (1 -> 2)'),
          timestamp: new Date('2026-02-06T23:04:00.000Z'),
        }),
      }),
    );
  });
});
