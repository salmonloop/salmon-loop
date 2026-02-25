import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { UIStoreProvider, useUIStore } from '../../../../src/cli/ui/store/context.js';

mock.module('ink', () => ({
  Box: (props: any) => React.createElement('div', null, props.children),
  Text: (props: any) => React.createElement('span', null, props.children),
}));

mock.module('../../../../src/cli/ui/hooks/useCommandLifecycle.js', () => ({
  useCommandLifecycle: () => ({
    signal: new AbortController().signal,
    isExiting: false,
    renewSignal: mock(),
  }),
}));

mock.module('../../../../src/cli/ui/hooks/useTerminalDimensions.js', () => ({
  useTerminalDimensions: () => {},
}));

mock.module('../../../../src/cli/ui/hooks/useLoopEvents.js', () => ({
  useLoopEvents: () => ({
    sanitizeAndDispatch: mock(),
  }),
}));

let latestOnSubmit: ((value: string) => void | Promise<void>) | null = null;
mock.module('../../../../src/cli/ui/components/CommandInput.js', () => ({
  CommandInput: (props: any) => {
    latestOnSubmit = props.onSubmit;
    return null;
  },
}));

mock.module('../../../../src/cli/ui/components/MessageList.js', () => ({
  MessageList: () => null,
}));

mock.module('../../../../src/cli/ui/components/StatusBannerLine.js', () => ({
  StatusBannerLine: () => null,
}));

mock.module('../../../../src/cli/ui/components/TodoDrawer.js', () => ({
  TodoDrawer: () => null,
}));

mock.module('../../../../src/cli/ui/components/animations/StretchingThinking.js', () => ({
  StretchingThinking: () => null,
}));

mock.module('../../../../src/core/plan/index.js', () => ({
  readPlan: mock(async () => ({})),
}));

mock.module('../../../../src/cli/commands/registry.js', () => ({
  getSuggestions: mock(async () => []),
}));

describe('chat UI', () => {
  it('does not duplicate the user message (AppCore does not add it)', async () => {
    const { AppCore } = await import('../../../../src/cli/ui/App.js');
    const onChatInput = mock(async () => ({}));

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
            onStart: mock(),
            onInit: mock(),
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
