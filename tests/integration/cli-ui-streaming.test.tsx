import { act, renderHook } from '@testing-library/react';
import React from 'react';

import { useLoopEvents } from '../../src/cli/ui/hooks/useLoopEvents.js';
import { UIStoreProvider, useUIStore } from '../../src/cli/ui/store/context.js';
import { advanceTimersByTime } from '../helpers/bun-timers.js';

function wrapper({ children }: { children: React.ReactNode }) {
  return <UIStoreProvider>{children}</UIStoreProvider>;
}

describe('CLI UI streaming integration', () => {
  beforeEach(() => {
    useFakeTimers();
  });

  afterEach(() => {
    useRealTimers();
  });

  it('aggregates llm.stream.delta into one AI message in chat mode', () => {
    const onStart = mock();
    const signal = new AbortController().signal;

    const { result } = renderHook(
      () => {
        const events = useLoopEvents('chat', onStart, signal);
        const store = useUIStore();
        return {
          sanitizeAndDispatch: events.sanitizeAndDispatch,
          state: store.state,
        };
      },
      { wrapper },
    );

    act(() => {
      result.current.sanitizeAndDispatch({
        type: 'llm.stream.delta',
        streamId: 'chat-stream-1',
        content: 'Plan ',
        timestamp: new Date('2026-02-06T23:30:00.000Z'),
      });
      result.current.sanitizeAndDispatch({
        type: 'llm.stream.delta',
        streamId: 'chat-stream-1',
        content: 'generated.',
        timestamp: new Date('2026-02-06T23:30:00.100Z'),
      });
    });

    act(() => {
      advanceTimersByTime(250);
    });

    const messages = [
      ...result.current.state.completedMessages,
      ...(result.current.state.activeStreamingMessage
        ? [result.current.state.activeStreamingMessage]
        : []),
    ];

    const aiMessages = messages.filter((message) => message.type === 'assistant');
    expect(aiMessages).toHaveLength(1);
    expect(aiMessages[0]?.content).toBe('Plan generated.');

    const nonWelcomeSystemMessages = messages.filter(
      (message) => message.type === 'system' && message.content !== 'WELCOME_LOGO',
    );
    expect(nonWelcomeSystemMessages).toHaveLength(0);
  });
});
