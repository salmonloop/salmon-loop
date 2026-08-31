import { render } from '@testing-library/react';
import React from 'react';

mock.module('ink', () => ({
  Box: (props: any) => React.createElement('div', null, props.children),
  Text: (props: any) => React.createElement('span', null, props.children),
}));

describe('CommandSuggestionList pagination', () => {
  async function loadCommandSuggestionList() {
    return (await import('../../../../../src/cli/ui/components/CommandSuggestionList.js'))
      .CommandSuggestionList;
  }

  it('hides pagination indicator when totalSuggestions <= suggestions.length', async () => {
    const CommandSuggestionList = await loadCommandSuggestionList();

    const { container } = render(
      <CommandSuggestionList
        suggestions={[
          { name: 'test1', description: 'desc1' },
          { name: 'test2', description: 'desc2' },
        ]}
        selectedIndex={0}
        totalSuggestions={2}
        startIndex={0}
      />,
    );

    // It should contain the shortcuts but NOT the pagination numbers
    expect(container.textContent).toContain('↑↓ nav · ⇥ complete · ⏎ select · esc close');
    expect(container.textContent).not.toContain('1-2 of 2');
  });

  it('shows pagination indicator when totalSuggestions > suggestions.length', async () => {
    const CommandSuggestionList = await loadCommandSuggestionList();

    const { container } = render(
      <CommandSuggestionList
        suggestions={[
          { name: 'test3', description: 'desc3' },
          { name: 'test4', description: 'desc4' },
        ]}
        selectedIndex={1}
        totalSuggestions={12}
        startIndex={2}
      />,
    );

    // It should contain both the pagination numbers (3-4 of 12) and the shortcuts
    expect(container.textContent).toContain('3-4 of 12');
    expect(container.textContent).toContain('↑↓ nav · ⇥ complete · ⏎ select · esc close');
  });
});
