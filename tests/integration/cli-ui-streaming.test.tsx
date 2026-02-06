import { act, renderHook } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

import { useLoopEvents } from '../../src/cli/ui/hooks/useLoopEvents.js';
import { UIStoreProvider, useUIStore } from '../../src/cli/ui/store/context.js';

function wrapper({ children }: { children: React.ReactNode }) {
  return <UIStoreProvider>{children}</UIStoreProvider>;
}

describe('CLI UI streaming integration', () => {
  it('aggregates llm.stream.delta into one AI message in chat mode', () => {
    const onStart = vi.fn();
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

    const aiMessages = result.current.state.messages.filter((message) => message.type === 'ai');
    expect(aiMessages).toHaveLength(1);
    expect(aiMessages[0]?.content).toBe('Plan generated.');

    const nonWelcomeSystemMessages = result.current.state.messages.filter(
      (message) => message.type === 'system' && message.content !== 'WELCOME_LOGO',
    );
    expect(nonWelcomeSystemMessages).toHaveLength(0);
  });
});
