import { useEffect, useCallback } from 'react';

import { useUIStore } from '../store/context.js';
import { prepareMessagePayload, sanitizeMessage } from '../utils/sanitizer.js';

/**
 * Hook to manage loop events and state synchronization.
 */
export function useLoopEvents(mode: 'run' | 'chat', onStart: any, signal: AbortSignal) {
  const { dispatch } = useUIStore();

  const sanitizeAndDispatch = useCallback(
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

  useEffect(() => {
    if (mode === 'run') {
      onStart(
        (event: any) => {
          // Route all events through sanitizer to ensure state safety
          if (event.type === 'llm.stream.delta') {
            const delta = sanitizeMessage({ content: event.content });
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
            sanitizeAndDispatch({ type: 'ai', content: event.content, timestamp: event.timestamp });
            return;
          }
          if (event.type === 'log') {
            sanitizeAndDispatch({ content: event.message, type: 'system' });
          } else if (event.content || event.message) {
            sanitizeAndDispatch(event);
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
        { signal },
      );
    }
  }, [mode, onStart, dispatch, signal, sanitizeAndDispatch]);

  return { sanitizeAndDispatch };
}
