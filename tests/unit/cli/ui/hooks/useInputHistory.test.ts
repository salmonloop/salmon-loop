import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';

import { useInputHistory } from '../../../../../src/cli/ui/hooks/useInputHistory.js';

const hoisted = vi.hoisted(() => ({
  state: {
    inputHistory: ['first', 'second'],
  },
}));

vi.mock('../../../../../src/cli/ui/store/context.js', () => ({
  useUIStore: () => ({ state: hoisted.state }),
}));

describe('useInputHistory', () => {
  it('resets navigation index when inputHistory is replaced (e.g. session switch)', () => {
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ currentValue }) => useInputHistory(currentValue, onChange),
      { initialProps: { currentValue: 'typing' } },
    );

    act(() => {
      result.current.navigateHistory('up');
    });
    expect(onChange).toHaveBeenCalledWith('second');

    onChange.mockClear();

    // Simulate session switch: store replaces the entire history array.
    hoisted.state.inputHistory = ['other-session'];
    rerender({ currentValue: '' });

    act(() => {
      result.current.navigateHistory('up');
    });

    expect(onChange).toHaveBeenCalledWith('other-session');
  });
});
