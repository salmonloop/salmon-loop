import { useEffect, useCallback } from 'react';

import { useUIStore } from '../store/context.js';
import { prepareMessagePayload, sanitizeMessage } from '../utils/sanitizer.js';

/**
 * Hook to manage loop events and state synchronization.
 */
export function useLoopEvents(mode: 'run' | 'chat', onStart: any, signal: AbortSignal) {
  const { dispatch } = useUIStore();

  const dispatchSanitizedMessage = useCallback(
    (ev: any) => {
      const payload = prepareMessagePayload(ev);
      if (!payload.content || payload.content.trim() === '') return;

      dispatch({
        type: 'ADD_MESSAGE',
        payload,
      });
    },
    [dispatch],
  );

  const handleEvent = useCallback(
    (event: any) => {
      if (!event) return;
      if (event.type === 'llm.stream.delta') {
        const delta = sanitizeMessage({ type: 'assistant', content: event.content });
        if (!delta.trim()) return;
        dispatch({
          type: 'APPEND_LLM_STREAM',
          payload: {
            id: event.streamId,
            delta,
            timestamp: event.timestamp || new Date(),
          },
        });
        return;
      }
      if (event.type === 'llm.output') {
        dispatchSanitizedMessage({
          type: 'assistant',
          content: event.content,
          timestamp: event.timestamp,
        });
        return;
      }
      if (event.type === 'log') {
        dispatchSanitizedMessage({ content: event.message, type: 'system' });
      } else if (event.content || event.message) {
        dispatchSanitizedMessage(event);
      }

      switch (event.type) {
        case 'phase.start':
          dispatch({ type: 'UPDATE_PHASE', payload: event.phase, status: 'running' });
          break;
        case 'workspace.ready':
          dispatch({
            type: 'UPDATE_WORKSPACE',
            payload: { path: event.path, isShadow: event.strategy === 'worktree' },
          });
          break;
        case 'diff.meta':
          dispatch({
            type: 'SET_CHANGED_FILES',
            payload: event.changedFiles,
          });
          break;
      }
    },
    [dispatch, dispatchSanitizedMessage],
  );

  useEffect(() => {
    if (mode === 'run') {
      onStart((event: any) => handleEvent(event), { signal });
    }
  }, [mode, onStart, signal, handleEvent]);

  return { sanitizeAndDispatch: handleEvent };
}
