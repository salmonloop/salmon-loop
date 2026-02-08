import { useState, useCallback, useRef, useEffect } from 'react';

import { useUIStore } from '../store/context.js';

export function useInputHistory(currentValue: string, onChange: (val: string) => void) {
  const { state } = useUIStore();
  // Use ref to track index synchronously to avoid closure staleness during rapid key presses
  const historyIndexRef = useRef(-1);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [originalInput, setOriginalInput] = useState('');

  // Sync ref with state (for external updates like reset)
  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  const navigateHistory = useCallback(
    (direction: 'up' | 'down') => {
      const userMessages = state.messages
        .filter((m) => m.type === 'user' && !m.content.startsWith('/'))
        .map((m) => m.content)
        .reverse();

      const currentIndex = historyIndexRef.current;

      if (direction === 'up') {
        if (currentIndex === -1) {
          setOriginalInput(currentValue);
        }
        const nextIndex = currentIndex + 1;
        if (nextIndex < userMessages.length) {
          historyIndexRef.current = nextIndex; // Immediate update
          setHistoryIndex(nextIndex); // Trigger re-render
          onChange(userMessages[nextIndex]);
          return true;
        }
      } else {
        if (currentIndex > 0) {
          const nextIndex = currentIndex - 1;
          historyIndexRef.current = nextIndex;
          setHistoryIndex(nextIndex);
          onChange(userMessages[nextIndex]);
          return true;
        } else if (currentIndex === 0) {
          historyIndexRef.current = -1;
          setHistoryIndex(-1);
          onChange(originalInput);
          return true;
        }
      }
      return false;
    },
    [state.messages, currentValue, originalInput, onChange], // Removed historyIndex from deps
  );

  const resetHistory = useCallback(() => {
    historyIndexRef.current = -1;
    setHistoryIndex(-1);
  }, []);

  return { navigateHistory, resetHistory };
}
