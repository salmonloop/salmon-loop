import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import React from 'react';

import { AppCore } from '../../../../src/cli/ui/App.js';
import { UIStoreProvider } from '../../../../src/cli/ui/store/context.js';

vi.mock('ink', () => ({
  Box: (props: any) => React.createElement('div', null, props.children),
  Text: (props: any) => React.createElement('span', null, props.children),
}));

vi.mock('../../../../src/cli/ui/hooks/useCommandLifecycle.js', () => ({
  useCommandLifecycle: () => ({
    signal: new AbortController().signal,
    isExiting: false,
    renewSignal: vi.fn(),
  }),
}));

vi.mock('../../../../src/cli/ui/hooks/useTerminalDimensions.js', () => ({
  useTerminalDimensions: () => {},
}));

vi.mock('../../../../src/cli/ui/components/CommandInput.js', () => ({
  CommandInput: () => null,
}));

vi.mock('../../../../src/cli/ui/components/MessageList.js', () => ({
  MessageList: () => null,
}));

vi.mock('../../../../src/cli/ui/components/StatusBannerLine.js', () => ({
  StatusBannerLine: () => null,
}));

vi.mock('../../../../src/cli/ui/components/TodoDrawer.js', () => ({
  TodoDrawer: () => null,
}));

vi.mock('../../../../src/cli/ui/components/animations/StretchingThinking.js', () => ({
  StretchingThinking: () => null,
}));

const readPlanMock = vi.fn(async (_args: any) => ({
  sessionId: 's',
  baseHash: 'h',
  active: [{ stepId: 'step-1', text: 'Task 1', checkbox: 'unchecked', status: 'todo' }],
  pending: [],
  recentDone: [],
  conflicts: { present: false },
}));

vi.mock('../../../../src/core/plan/index.js', () => ({
  readPlan: (args: any) => readPlanMock(args),
}));

let interceptEvent: ((event: any) => void) | undefined;
vi.mock('../../../../src/cli/ui/hooks/useLoopEvents.js', () => ({
  useLoopEvents: (_mode: any, _onStart: any, _signal: any, options: any) => {
    interceptEvent = options?.interceptEvent;
    return {
      sanitizeAndDispatch: (event: any) => {
        interceptEvent?.(event);
      },
    };
  },
}));

describe('AppCore TODO reset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    interceptEvent = undefined;
    readPlanMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not re-hydrate stale plan TODOs on run.start before plan.runtime.ready', () => {
    render(
      React.createElement(
        UIStoreProvider,
        null,
        React.createElement(AppCore as any, {
          mode: 'chat',
          onStart: vi.fn(),
          onChatInput: vi.fn(),
          sessionManager: { getCurrent: () => ({ meta: { repoPath: process.cwd() } }) },
        }),
      ),
    );

    act(() => {
      interceptEvent?.({
        type: 'plan.runtime.ready',
        sessionId: 'old-session',
        planPathHint: '.salmonloop/plans/old-session/SALMONLOOP_PLAN.md',
        timestamp: new Date('2026-02-14T00:00:00.000Z'),
      });
      vi.advanceTimersByTime(200);
    });

    expect(readPlanMock).toHaveBeenCalledTimes(1);
    readPlanMock.mockClear();

    act(() => {
      interceptEvent?.({
        type: 'run.start',
        mode: 'chat',
        timestamp: new Date('2026-02-14T00:00:01.000Z'),
      });
      vi.advanceTimersByTime(200);
    });

    expect(readPlanMock).toHaveBeenCalledTimes(0);
  });

  it('reloads TODOs after a new plan.runtime.ready following run.start', () => {
    render(
      React.createElement(
        UIStoreProvider,
        null,
        React.createElement(AppCore as any, {
          mode: 'chat',
          onStart: vi.fn(),
          onChatInput: vi.fn(),
          sessionManager: { getCurrent: () => ({ meta: { repoPath: process.cwd() } }) },
        }),
      ),
    );

    act(() => {
      interceptEvent?.({
        type: 'plan.runtime.ready',
        sessionId: 'old-session',
        planPathHint: '.salmonloop/plans/old-session/SALMONLOOP_PLAN.md',
        timestamp: new Date('2026-02-14T00:00:00.000Z'),
      });
      vi.advanceTimersByTime(200);
    });

    expect(readPlanMock).toHaveBeenCalledTimes(1);
    expect(readPlanMock.mock.calls[0]?.[0]?.sessionId).toBe('old-session');

    act(() => {
      interceptEvent?.({
        type: 'run.start',
        mode: 'chat',
        timestamp: new Date('2026-02-14T00:00:01.000Z'),
      });
      vi.advanceTimersByTime(200);
    });

    expect(readPlanMock).toHaveBeenCalledTimes(1);

    act(() => {
      interceptEvent?.({
        type: 'plan.runtime.ready',
        sessionId: 'new-session',
        planPathHint: '.salmonloop/plans/new-session/SALMONLOOP_PLAN.md',
        timestamp: new Date('2026-02-14T00:00:02.000Z'),
      });
      vi.advanceTimersByTime(200);
    });

    expect(readPlanMock).toHaveBeenCalledTimes(2);
    expect(readPlanMock.mock.calls[1]?.[0]?.sessionId).toBe('new-session');
  });
});
