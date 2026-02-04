import { useState, useCallback } from 'react';

import { useUIStore } from '../store/context.js';

export function useInputHistory(currentValue: string, onChange: (val: string) => void) {
  const { state } = useUIStore();
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [originalInput, setOriginalInput] = useState('');

  const navigateHistory = useCallback(
    (direction: 'up' | 'down') => {
      const userMessages = state.messages
        .filter((m) => m.type === 'user' && !m.content.startsWith('/'))
        .map((m) => m.content)
        .reverse();

      if (direction === 'up') {
        if (historyIndex === -1) {
          setOriginalInput(currentValue);
        }
        const nextIndex = historyIndex + 1;
        if (nextIndex < userMessages.length) {
          setHistoryIndex(nextIndex);
          onChange(userMessages[nextIndex]);
          return true;
        }
      } else {
        if (historyIndex > 0) {
          const nextIndex = historyIndex - 1;
          setHistoryIndex(nextIndex);
          onChange(userMessages[nextIndex]);
          return true;
        } else if (historyIndex === 0) {
          setHistoryIndex(-1);
          onChange(originalInput);
          return true;
        }
      }
      return false;
    },
    [state.messages, historyIndex, currentValue, originalInput, onChange],
  );

  const resetHistory = useCallback(() => {
    setHistoryIndex(-1);
  }, []);

  return { navigateHistory, resetHistory };
}
