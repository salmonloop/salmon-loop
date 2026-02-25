import { render } from '@testing-library/react';
import React from 'react';

const hoisted = (() => ({
  markdownSpy: mock(),
}))();

mock.module('ink', () => ({
  Box: (props: any) => React.createElement('div', null, props.children),
  Text: (props: any) => React.createElement('span', null, props.children),
  Static: (props: any) =>
    React.createElement(
      React.Fragment,
      null,
      ...(Array.isArray(props.items)
        ? props.items.map((item: any, index: number) => props.children(item, index))
        : []),
    ),
}));

mock.module('../../../../../src/cli/ui/components/Markdown.js', () => ({
  Markdown: (props: any) => {
    hoisted.markdownSpy(props.children);
    return React.createElement('div', { 'data-testid': 'markdown' }, props.children);
  },
}));

mock.module('../../../../../src/cli/ui/components/WelcomeMessage.js', () => ({
  WelcomeMessage: () => null,
}));

mock.module('../../../../../src/cli/ui/store/context.js', () => ({
  useUIStore: () => ({
    state: {
      completedMessages: [],
      logView: 'standard',
      activeStreamingMessage: {
        id: 'stream-1',
        type: 'assistant',
        content: '- **streaming markdown**',
        timestamp: new Date('2026-02-13T12:00:00.000Z'),
        streamState: 'streaming',
      },
      queueMessages: [],
      terminalWidth: 120,
      terminalHeight: 30,
    },
  }),
}));

describe('MessageList streaming rendering', () => {
  beforeEach(() => {
    hoisted.markdownSpy.mockClear();
  });

  it('does not parse streaming content as Markdown', async () => {
    const { MessageList } = await import('../../../../../src/cli/ui/components/MessageList.js');
    const result = render(
      React.createElement(MessageList, {
        markdownTheme: 'default',
        markdownRenderMode: 'enhanced',
      }),
    );

    expect(hoisted.markdownSpy).not.toHaveBeenCalled();
    expect(result.container.textContent).toContain('- **streaming markdown**');
  });
});
