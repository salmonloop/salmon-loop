import { useEffect, useCallback, useRef } from 'react';

import { text } from '../../locales/index.js';
import { useUIStore } from '../store/context.js';
import { MessageType } from '../store/types.js';
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

      // Intercept cancellation errors and treat them as interrupts
      // This ensures we show the "^C [SPLATTED]" style instead of a generic error
      const isCancellation =
        (event.type === 'error' && event.error?.message === 'Operation cancelled by user') ||
        event.message === 'Operation cancelled by user' ||
        (typeof event.error === 'string' && event.error.includes('Operation cancelled by user'));

      if (isCancellation) {
        dispatch({ type: 'INTERRUPT_STREAM' });
        return;
      }

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
        const msg = event.message || '';
        let type = 'system';
        const content = msg;

        // Auto-detect message types based on content to match new design system
        if (msg.includes('Patch generated')) {
          type = 'patch_step';
        } else if (msg.includes('Plan generated')) {
          type = 'plan_step';
        } else if (msg.startsWith('Analyzing')) {
          type = 'thinking';
        }

        dispatchSanitizedMessage({ content, type });
      } else if (event.type === 'snapshot.created') {
        // Handle structured snapshot event
        dispatchSanitizedMessage({
          type: 'checkpoint',
          content: event.commitHash.slice(0, 8),
          timestamp: event.timestamp,
        });
      } else if (event.content || event.message) {
        dispatchSanitizedMessage(event);
      }

      switch (event.type) {
        case 'phase.start': {
          dispatch({ type: 'UPDATE_PHASE', payload: event.phase, status: 'running' });

          // Explicit mapping: Add blue label messages to the UI list when key phases start
          const phaseTypeMap: Record<string, MessageType> = {
            PREFLIGHT: 'preflight_step',
            CONTEXT: 'context_step',
            EXPLORE: 'explore_step',
            PLAN: 'plan_step',
            PATCH: 'patch_step',
            APPLY: 'apply_step',
            VALIDATE: 'validate_step',
            AST_VALIDATE: 'ast_validate_step',
            VERIFY: 'verify_step',
            ROLLBACK: 'rollback_step',
            SHRINK: 'shrink_step',
            REVIEW: 'review_step',
            REPORT: 'report_step',
            ANALYZE_ISSUES: 'analyze_issues_step',
          };

          const guiType = phaseTypeMap[event.phase.toUpperCase()];
          if (guiType) {
            const phaseKey = event.phase.toLowerCase();
            const phaseName = (text.progress as any)[phaseKey] || event.phase;
            dispatch({
              type: 'ADD_MESSAGE',
              payload: {
                id: `phase-${event.phase}-${Date.now()}`,
                type: guiType,
                content: phaseName,
                timestamp: event.timestamp || new Date(),
              },
            });
          }
          break;
        }
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
