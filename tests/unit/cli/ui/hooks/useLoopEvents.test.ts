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

    expect(hoisted.dispatch).toHaveBeenCalledWith({
      type: 'APPEND_LLM_STREAM',
      payload: {
        id: 'stream-run-1',
        delta: 'hello',
        timestamp: new Date('2026-02-06T23:01:00.000Z'),
      },
    });
  });
});
