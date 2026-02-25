import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { AppCore } from '../../../../src/cli/ui/App.js';
import { UIStoreProvider } from '../../../../src/cli/ui/store/context.js';

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

mock.module('../../../../src/cli/ui/components/CommandInput.js', () => ({
  CommandInput: () => null,
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

describe('AppCore', () => {
  it('invokes onInit once in chat mode', async () => {
    const onInit = mock();

    render(
      React.createElement(
        UIStoreProvider,
        null,
        React.createElement(AppCore as any, {
          mode: 'chat',
          onStart: mock(),
          onInit,
          onChatInput: mock(),
          sessionManager: { getCurrent: () => ({ meta: { repoPath: process.cwd() } }) },
        }),
      ),
    );

    await waitFor(() => expect(onInit).toHaveBeenCalledTimes(1));
  });
});
