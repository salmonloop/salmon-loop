import { render } from '@testing-library/react';
import React from 'react';
import { vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  inputHandler: null as ((input: string, key: any) => void) | null,
  textInputProps: null as any,
  dispatch: vi.fn(),
}));

vi.mock('ink', () => ({
  Box: (props: any) => React.createElement('div', null, props.children),
  Text: (props: any) => React.createElement('span', null, props.children),
  useInput: (handler: (input: string, key: any) => void) => {
    hoisted.inputHandler = handler;
  },
}));

vi.mock('ink-text-input', () => ({
  default: (props: any) => {
    hoisted.textInputProps = props;
    return null;
  },
}));

vi.mock('../../../../../src/cli/ui/hooks/useCommandSuggestions.js', () => ({
  useCommandSuggestions: () => ({
    suggestions: [],
    selectedIndex: -1,
    startIndex: 0,
    isListClosed: true,
    setIsListClosed: vi.fn(),
    setSuggestions: vi.fn(),
    setSelectedIndex: vi.fn(),
    setStartIndex: vi.fn(),
    navigateSuggestions: vi.fn(() => false),
    activeCommand: null,
  }),
}));

vi.mock('../../../../../src/cli/ui/hooks/useInputHistory.js', () => ({
  useInputHistory: () => ({
    navigateHistory: vi.fn(),
    resetHistory: vi.fn(),
  }),
}));

vi.mock('../../../../../src/cli/ui/store/context.js', () => ({
  useUIStore: () => ({
    state: {
      pendingConfirmation: undefined,
      pendingAuthorization: undefined,
      pendingSelection: undefined,
    },
    dispatch: hoisted.dispatch,
  }),
}));

vi.mock('../../../../../src/cli/ui/authorization/bus.js', () => ({
  rejectAuthorization: vi.fn(),
}));

vi.mock('../../../../../src/cli/ui/selection/bus.js', () => ({
  rejectSelection: vi.fn(),
  resolveSelection: vi.fn(),
}));

describe('CommandInput shortcuts', () => {
  async function loadCommandInput() {
    return (await import('../../../../../src/cli/ui/components/CommandInput.js')).CommandInput;
  }

  beforeEach(() => {
    hoisted.inputHandler = null;
    hoisted.textInputProps = null;
    hoisted.dispatch.mockClear();
  });

  it('suppresses Ctrl+T so it does not type into the input', async () => {
    const CommandInput = await loadCommandInput();
    const onChange = vi.fn();
    const onSubmit = vi.fn();

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
    const onChange = vi.fn();
    const onSubmit = vi.fn();

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
});
