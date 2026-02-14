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

  // When the store replaces history (e.g. switching sessions), reset navigation state.
  useEffect(() => {
    historyIndexRef.current = -1;
    setHistoryIndex(-1);
    setOriginalInput('');
  }, [state.inputHistory]);

  const navigateHistory = useCallback(
    (direction: 'up' | 'down') => {
      const history = [...state.inputHistory].reverse();
      const currentIndex = historyIndexRef.current;

      if (direction === 'up') {
        if (currentIndex === -1) {
          setOriginalInput(currentValue);
        }
        const nextIndex = currentIndex + 1;
        if (nextIndex < history.length) {
          historyIndexRef.current = nextIndex;
          setHistoryIndex(nextIndex);
          onChange(history[nextIndex]);
          return true;
        }
      } else {
        if (currentIndex > 0) {
          const nextIndex = currentIndex - 1;
          historyIndexRef.current = nextIndex;
          setHistoryIndex(nextIndex);
          onChange(history[nextIndex]);
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
    [state.inputHistory, currentValue, originalInput, onChange],
  );

  const resetHistory = useCallback(() => {
    historyIndexRef.current = -1;
    setHistoryIndex(-1);
  }, []);

  return { navigateHistory, resetHistory };
}
