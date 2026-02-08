import { useEffect, useCallback, useRef } from 'react';

import { useUIStore } from '../store/context.js';
import { prepareMessagePayload, sanitizeMessage } from '../utils/sanitizer.js';

/**
 * Hook to manage loop events and state synchronization.
 */
export function useLoopEvents(mode: 'run' | 'chat', onStart: any, signal: AbortSignal) {
  const { dispatch } = useUIStore();

  // Throttle state for streaming deltas to prevent render thrashing
  const streamBufferRef = useRef<Map<string, { delta: string; timestamp: Date }>>(new Map());
  const streamTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

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

  // Throttled dispatch for streaming deltas (100ms batching)
  const throttledStreamDispatch = useCallback(
    (streamId: string, delta: string, timestamp: Date) => {
      const buffer = streamBufferRef.current.get(streamId);

      if (buffer) {
        // Accumulate delta into existing buffer
        buffer.delta += delta;
        buffer.timestamp = timestamp;
      } else {
        // Create new buffer for this stream
        streamBufferRef.current.set(streamId, { delta, timestamp });
      }

      // Clear existing timer if any
      const existingTimer = streamTimerRef.current.get(streamId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      // Set new timer to flush after 100ms
      const timer = setTimeout(() => {
        const bufferedData = streamBufferRef.current.get(streamId);
        if (bufferedData) {
          dispatch({
            type: 'APPEND_LLM_STREAM',
            payload: {
              id: streamId,
              delta: bufferedData.delta,
              timestamp: bufferedData.timestamp,
            },
          });
          streamBufferRef.current.delete(streamId);
          streamTimerRef.current.delete(streamId);
        }
      }, 100); // 100ms throttle window

      streamTimerRef.current.set(streamId, timer);
    },
    [dispatch],
  );

  // Flush all pending throttled streams AND complete active streaming to prevent message ordering issues
  const flushAllStreams = useCallback(() => {
    // 1. Flush all pending throttle buffers first
    streamTimerRef.current.forEach((timer, streamId) => {
      clearTimeout(timer);
      const bufferedData = streamBufferRef.current.get(streamId);
      if (bufferedData) {
        dispatch({
          type: 'APPEND_LLM_STREAM',
          payload: {
            id: streamId,
            delta: bufferedData.delta,
            timestamp: bufferedData.timestamp,
          },
        });
      }
    });
    streamBufferRef.current.clear();
    streamTimerRef.current.clear();

    // 2. Complete any active streaming message to move it to completedMessages
    // This ensures the streaming message appears before subsequent non-streaming messages
    dispatch({ type: 'COMPLETE_STREAM', payload: { id: 'flush-all' } });
  }, [dispatch]);

  const handleEvent = useCallback(
    (event: any) => {
      if (!event) return;
      if (event.type === 'llm.stream.delta') {
        const delta = sanitizeMessage({ type: 'assistant', content: event.content });
        if (!delta.trim()) return;

        // Use throttled dispatch instead of direct dispatch
        throttledStreamDispatch(event.streamId, delta, event.timestamp || new Date());
        return;
      }

      // For all non-streaming events, flush pending streams first to maintain chronological order
      // This prevents throttled stream messages from appearing AFTER events that occurred earlier
      flushAllStreams();

      if (event.type === 'llm.output') {
        // Stream already completed by flushAllStreams(), just add the final message
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
    [dispatch, dispatchSanitizedMessage, throttledStreamDispatch, flushAllStreams],
  );

  useEffect(() => {
    if (mode === 'run') {
      onStart((event: any) => handleEvent(event), { signal });
    }
  }, [mode, onStart, signal, handleEvent]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      streamTimerRef.current.forEach((timer) => clearTimeout(timer));
      streamTimerRef.current.clear();
      streamBufferRef.current.clear();
    };
  }, []);

  return { sanitizeAndDispatch: handleEvent };
}
