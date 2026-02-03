import { useInput } from 'ink';
import { useState, useCallback, useRef } from 'react';

import { useUIStore } from '../store/context.js';

/**
 * Custom hook to manage the lifecycle of CLI commands, including
 * interruption signals (AbortController) and exit logic.
 */
export function useCommandLifecycle(
  status: 'running' | 'success' | 'failed' | 'idle',
  onExit: () => void,
) {
  const { dispatch } = useUIStore();
  const [abortController, setAbortController] = useState(new AbortController());
  const [isExiting, setIsExiting] = useState(false);
  const exitTimer = useRef<NodeJS.Timeout | null>(null);

  /**
   * Generates a new AbortController and returns its signal.
   * Useful when starting a new task after the previous one was aborted.
   */
  const renewSignal = useCallback(() => {
    const newController = new AbortController();
    setAbortController(newController);
    return newController.signal;
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (status === 'running') {
        // First tap while running: Splat interrupt
        abortController.abort();
        dispatch({ type: 'INTERRUPT_STREAM' });
        renewSignal();
        return;
      }

      if (isExiting) {
        // Double tap Ctrl+C: Force exit
        onExit();
        return;
      }

      // First tap while idle: Prepare for exit
      setIsExiting(true);

      // Reset exiting state after 2 seconds if not tapped again
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => {
        setIsExiting(false);
      }, 2000);
    }
  });

  return {
    signal: abortController.signal,
    isExiting,
    renewSignal,
  };
}
