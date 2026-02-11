import { useInput } from 'ink';
import { useState, useCallback, useRef, useEffect } from 'react';

import { KAOMOJI } from '../../../core/ui/kaomoji.js';
import { text } from '../../locales/index.js';
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
  const statusBannerTimer = useRef<NodeJS.Timeout | null>(null);
  const interruptFinalizeTimer = useRef<NodeJS.Timeout | null>(null);
  const escCountRef = useRef(0);

  useEffect(() => {
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current);
      if (escTimer.current) clearTimeout(escTimer.current);
      if (statusBannerTimer.current) clearTimeout(statusBannerTimer.current);
      if (interruptFinalizeTimer.current) clearTimeout(interruptFinalizeTimer.current);
    };
  }, []);

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
    dispatch({
      type: 'INTERRUPT_STREAM',
      payload: { timestamp: new Date() },
    });
    dispatch({
      type: 'SET_STATUS_BANNER',
      payload: {
        face: KAOMOJI.cleanupWorking,
        label: text.ui.status.stopping,
        source: 'lifecycle',
      },
    });
    if (statusBannerTimer.current) clearTimeout(statusBannerTimer.current);
    statusBannerTimer.current = setTimeout(() => {
      dispatch({ type: 'CLEAR_STATUS_BANNER', payload: { source: 'lifecycle' } });
    }, 15_000);

    if (interruptFinalizeTimer.current) clearTimeout(interruptFinalizeTimer.current);
    interruptFinalizeTimer.current = setTimeout(() => {
      dispatch({ type: 'FINALIZE_INTERRUPT' });
    }, 30_000);
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
