import { act, renderHook } from '@testing-library/react';
import { mock, describe, it, beforeEach, afterEach, expect, jest } from 'bun:test';

import { text } from '../../../../../src/cli/locales/index.js';
import { advanceTimersByTime } from '../../../../helpers/bun-timers.js';

const hoisted = (() => ({
  dispatch: mock(),
}))();

mock.module('../../../../../src/cli/ui/store/context.js', () => ({
  useUIStore: () => ({ dispatch: hoisted.dispatch }),
}));

describe('useLoopEvents', () => {
  async function loadUseLoopEvents() {
    return (await import('../../../../../src/cli/ui/hooks/useLoopEvents.js')).useLoopEvents;
  }

  beforeEach(() => {
    hoisted.dispatch.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('aggregates llm.stream.delta as APPEND_LLM_STREAM in chat mode', async () => {
    const useLoopEvents = await loadUseLoopEvents();
    const onStart = mock();
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
      advanceTimersByTime(100);
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

  it('registers run callback and routes stream delta through APPEND_LLM_STREAM', async () => {
    const useLoopEvents = await loadUseLoopEvents();
    const signal = new AbortController().signal;
    let capturedHandler: ((event: any) => void) | undefined;
    const onStart = mock((handler: (event: any) => void) => {
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
      advanceTimersByTime(100);
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

  it('dispatches SET_STATUS_BANNER for ui.status set events', async () => {
    const useLoopEvents = await loadUseLoopEvents();
    const onStart = mock();
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

  it('dispatches CLEAR_STATUS_BANNER for ui.status clear events', async () => {
    const useLoopEvents = await loadUseLoopEvents();
    const onStart = mock();
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

  it('dispatches a warning message for retry events', async () => {
    const useLoopEvents = await loadUseLoopEvents();
    const onStart = mock();
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

  it('does not complete stream when handling non-stream events', async () => {
    const useLoopEvents = await loadUseLoopEvents();
    const onStart = mock();
    const signal = new AbortController().signal;
    const { result } = renderHook(() => useLoopEvents('chat', onStart, signal));

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'llm.stream.delta',
        streamId: 'stream-chat-2',
        content: 'hello',
        timestamp: new Date('2026-02-06T23:05:00.000Z'),
      });
    });

    act(() => {
      advanceTimersByTime(100);
    });

    hoisted.dispatch.mockClear();

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'log',
        level: 'debug',
        message: 'next event after stream delta',
        timestamp: new Date('2026-02-06T23:05:00.200Z'),
      });
    });

    expect(hoisted.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'COMPLETE_STREAM' }),
    );
  });

  it('flushes and completes stream on llm.stream.end', async () => {
    const useLoopEvents = await loadUseLoopEvents();
    const onStart = mock();
    const signal = new AbortController().signal;
    const { result } = renderHook(() => useLoopEvents('chat', onStart, signal));

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'llm.stream.delta',
        streamId: 'stream-chat-end-1',
        content: 'hi',
        timestamp: new Date('2026-02-06T23:06:00.000Z'),
      });
    });

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'llm.stream.end',
        streamId: 'stream-chat-end-1',
        timestamp: new Date('2026-02-06T23:06:00.050Z'),
      });
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith({
      type: 'APPEND_LLM_STREAM',
      payload: {
        id: 'stream-chat-end-1',
        delta: 'hi',
        timestamp: new Date('2026-02-06T23:06:00.000Z'),
      },
    });
    expect(hoisted.dispatch).toHaveBeenCalledWith({
      type: 'COMPLETE_STREAM',
      payload: { id: 'stream-chat-end-1' },
    });
  });

  it('maps redacted log messages to localized text in the UI', async () => {
    const useLoopEvents = await loadUseLoopEvents();
    const onStart = mock();
    const signal = new AbortController().signal;
    const { result } = renderHook(() => useLoopEvents('chat', onStart, signal));

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'log',
        level: 'error',
        message: 'ERR_TECHNICAL_DETAILS_HIDDEN',
        timestamp: new Date('2026-02-06T23:07:00.000Z'),
      });
    });

    expect(hoisted.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ADD_MESSAGE',
        payload: expect.objectContaining({
          content: text.errors.technicalDetailsHidden,
        }),
      }),
    );
  });
});
