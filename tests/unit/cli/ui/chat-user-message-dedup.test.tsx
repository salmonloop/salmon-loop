import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

import { UIStoreProvider, useUIStore } from '../../../../src/cli/ui/store/context.js';

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

vi.mock('../../../../src/cli/ui/hooks/useLoopEvents.js', () => ({
  useLoopEvents: () => ({
    sanitizeAndDispatch: vi.fn(),
  }),
}));

let latestOnSubmit: ((value: string) => void | Promise<void>) | null = null;
vi.mock('../../../../src/cli/ui/components/CommandInput.js', () => ({
  CommandInput: (props: any) => {
    latestOnSubmit = props.onSubmit;
    return null;
  },
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

vi.mock('../../../../src/core/plan/index.js', () => ({
  readPlan: vi.fn(async () => ({})),
}));

vi.mock('../../../../src/cli/commands/registry.js', () => ({
  getSuggestions: vi.fn(async () => []),
}));

describe('chat UI', () => {
  it('does not duplicate the user message (AppCore does not add it)', async () => {
    const { AppCore } = await import('../../../../src/cli/ui/App.js');
    const onChatInput = vi.fn(async () => ({}));

    let observedState: any = null;
    const StateProbe = () => {
      const store = useUIStore() as any;
      observedState = store.state;
      return null;
    };

    render(
      React.createElement(
        UIStoreProvider,
        null,
        React.createElement(React.Fragment, null, [
          React.createElement(AppCore as any, {
            key: 'app',
            mode: 'chat',
            onStart: vi.fn(),
            onInit: vi.fn(),
            onChatInput,
            sessionManager: { getCurrent: () => ({ meta: { repoPath: process.cwd() } }) },
          }),
          React.createElement(StateProbe, { key: 'probe' }),
        ]),
      ),
    );

    await waitFor(() => expect(latestOnSubmit).toBeTypeOf('function'));
    await latestOnSubmit?.('hello');

    await waitFor(() => expect(onChatInput).toHaveBeenCalledTimes(1));
    const userMessages = (observedState?.completedMessages ?? []).filter(
      (m: any) => m?.type === 'user',
    );
    expect(userMessages).toHaveLength(0);
  });
});
