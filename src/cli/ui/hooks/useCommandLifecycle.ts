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
  const escTimer = useRef<NodeJS.Timeout | null>(null);
  const escCountRef = useRef(0);

  /**
   * Generates a new AbortController and returns its signal.
   * Useful when starting a new task after the previous one was aborted.
   */
  const renewSignal = useCallback(() => {
    const newController = new AbortController();
    setAbortController(newController);
    return newController.signal;
  }, []);

  const splatInterrupt = useCallback(() => {
    abortController.abort();
    dispatch({ type: 'INTERRUPT_STREAM' });
    renewSignal();
  }, [abortController, dispatch, renewSignal]);

  const armExit = useCallback(() => {
    setIsExiting(true);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    exitTimer.current = setTimeout(() => {
      setIsExiting(false);
    }, 2000);
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isExiting) {
        // Double tap Ctrl+C: Force exit
        onExit();
        return;
      }

      if (status === 'running') {
        // First tap while running: Splat interrupt
        splatInterrupt();
        armExit();
        return;
      }

      // First tap while idle: Prepare for exit
      armExit();
      return;
    }

    if (key.escape && status === 'running') {
      escCountRef.current += 1;

      if (escTimer.current) clearTimeout(escTimer.current);
      escTimer.current = setTimeout(() => {
        escCountRef.current = 0;
      }, 600);

      if (escCountRef.current >= 2) {
        escCountRef.current = 0;
        splatInterrupt();
      }
    }
  });

  return {
    signal: abortController.signal,
    isExiting,
    renewSignal,
  };
}
