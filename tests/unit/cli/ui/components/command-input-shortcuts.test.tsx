import { render } from '@testing-library/react';
import React from 'react';

const hoisted = (() => ({
  inputHandler: null as ((input: string, key: any) => void) | null,
  textInputProps: null as any,
  dispatch: mock(),
  pendingSelection: undefined as
    | {
        id: string;
        title: string;
        multiSelect?: boolean;
        items: Array<{ id: string; label: string; description?: string }>;
      }
    | undefined,
}))();

mock.module('ink', () => ({
  Box: (props: any) => React.createElement('div', null, props.children),
  Text: (props: any) => React.createElement('span', null, props.children),
  useInput: (handler: (input: string, key: any) => void) => {
    hoisted.inputHandler = handler;
  },
}));

mock.module('ink-text-input', () => ({
  default: (props: any) => {
    hoisted.textInputProps = props;
    return null;
  },
}));

mock.module('../../../../../src/cli/ui/hooks/useCommandSuggestions.js', () => ({
  useCommandSuggestions: () => ({
    suggestions: [],
    selectedIndex: -1,
    startIndex: 0,
    isListClosed: true,
    setIsListClosed: mock(),
    setSuggestions: mock(),
    setSelectedIndex: mock(),
    setStartIndex: mock(),
    navigateSuggestions: mock(() => false),
    activeCommand: null,
  }),
}));

mock.module('../../../../../src/cli/ui/hooks/useInputHistory.js', () => ({
  useInputHistory: () => ({
    navigateHistory: mock(),
    resetHistory: mock(),
  }),
}));

mock.module('../../../../../src/cli/ui/store/context.js', () => ({
  useUIStore: () => ({
    state: {
      pendingConfirmation: undefined,
      pendingAuthorization: undefined,
      pendingSelection: hoisted.pendingSelection,
    },
    dispatch: hoisted.dispatch,
  }),
}));

mock.module('../../../../../src/cli/ui/authorization/bus.js', () => ({
  rejectAuthorization: mock(),
}));

mock.module('../../../../../src/cli/ui/selection/bus.js', () => ({
  rejectSelection: mock(),
  resolveSelection: mock(),
}));

describe('CommandInput shortcuts', () => {
  async function loadCommandInput() {
    return (await import('../../../../../src/cli/ui/components/CommandInput.js')).CommandInput;
  }

  beforeEach(() => {
    hoisted.inputHandler = null;
    hoisted.textInputProps = null;
    hoisted.pendingSelection = undefined;
    hoisted.dispatch.mockClear();
  });

  it('suppresses Ctrl+T so it does not type into the input', async () => {
    const CommandInput = await loadCommandInput();
    const onChange = mock();
    const onSubmit = mock();

    render(
      <CommandInput
        value="hello"
        onChange={onChange}
        onSubmit={onSubmit}
        getSuggestions={async () => []}
      />,
    );

    expect(hoisted.inputHandler).not.toBeNull();
    expect(hoisted.textInputProps?.onChange).toBeTypeOf('function');

    hoisted.inputHandler?.('t', { ctrl: true, name: 't' });
    hoisted.textInputProps.onChange('hellot');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('allows normal typing', async () => {
    const CommandInput = await loadCommandInput();
    const onChange = mock();
    const onSubmit = mock();

    render(
      <CommandInput
        value="hello"
        onChange={onChange}
        onSubmit={onSubmit}
        getSuggestions={async () => []}
      />,
    );

    hoisted.textInputProps.onChange('hellox');

    expect(onChange).toHaveBeenCalledWith('hellox');
  });

  it('renders a structural focus marker for the active selection item', async () => {
    const CommandInput = await loadCommandInput();
    hoisted.pendingSelection = {
      id: 'selection-1',
      title: 'Pick one',
      items: [
        { id: 'alpha', label: 'Alpha', description: 'first' },
        { id: 'beta', label: 'Beta', description: 'second' },
      ],
    };

    const { container } = render(
      <CommandInput value="" onChange={mock()} onSubmit={mock()} getSuggestions={async () => []} />,
    );

    expect(container.textContent).toContain('❯ Alpha - first');
    expect(container.textContent).toContain('  Beta - second');
  });
});
