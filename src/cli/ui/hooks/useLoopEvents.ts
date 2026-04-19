import { useEffect, useCallback, useRef } from 'react';

import { mapErrorForDisplay } from '../../../core/observability/error-mapping.js';
import { KAOMOJI } from '../../../core/ui/kaomoji.js';
import { text } from '../../locales/index.js';
import { useUIStore } from '../store/context.js';
import { MessageType } from '../store/types.js';
import { prepareMessagePayload, sanitizeMessage } from '../utils/sanitizer.js';

type UiLogMode = import('../../../core/config/types.js').UiLogMode;

/**
 * Hook to manage loop events and state synchronization.
 */
export function useLoopEvents(
  mode: 'run' | 'chat',
  onStart: any,
  signal: AbortSignal,
  options?: {
    interceptEvent?: (event: any) => void;
  },
) {
  const store = useUIStore() as any;
  const dispatch = store.dispatch as any;
  const runStartedRef = useRef(false);
  const activeStreamIdRef = useRef<string | null>(null);
  const logModeRef = useRef<UiLogMode>('normal');

  // Throttle state for streaming deltas to prevent render thrashing
  const streamBufferRef = useRef<Map<string, { delta: string; timestamp: Date }>>(new Map());
  const streamTimerRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const statusBannerTimerRef = useRef<NodeJS.Timeout | null>(null);

  const logModeValue: UiLogMode = store.state?.logMode ?? 'normal';
  useEffect(() => {
    logModeRef.current = logModeValue;
  }, [logModeValue]);

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

      const existingTimer = streamTimerRef.current.get(streamId);
      if (existingTimer) {
        return;
      }

      // Set new timer to flush after 100ms (true throttle: do not reset per-delta)
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

  const flushStream = useCallback(
    (streamId: string) => {
      const timer = streamTimerRef.current.get(streamId);
      if (timer) clearTimeout(timer);

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

      streamBufferRef.current.delete(streamId);
      streamTimerRef.current.delete(streamId);
    },
    [dispatch],
  );

  // Flush pending throttled buffers so stream output stays chronologically correct.
  // Stream completion is handled by explicit `llm.stream.end` events.
  const flushAllStreams = useCallback(() => {
    const ids = new Set([...streamBufferRef.current.keys(), ...streamTimerRef.current.keys()]);
    for (const streamId of ids) flushStream(streamId);
  }, [flushStream]);

  const handleEvent = useCallback(
    (event: any) => {
      if (!event) return;

      options?.interceptEvent?.(event);
      const logMode = logModeRef.current;

      if (event.type === 'ui.status') {
        if (event.action === 'clear') {
          dispatch({ type: 'CLEAR_STATUS_BANNER' });
          return;
        }

        if (typeof event.face === 'string' && event.face.trim()) {
          dispatch({
            type: 'SET_STATUS_BANNER',
            payload: {
              face: event.face,
              label: typeof event.label === 'string' ? event.label : '',
              source: 'runtime',
            },
          });
        }

        if (statusBannerTimerRef.current) clearTimeout(statusBannerTimerRef.current);
        if (typeof event.ttlMs === 'number' && Number.isFinite(event.ttlMs) && event.ttlMs > 0) {
          statusBannerTimerRef.current = setTimeout(() => {
            dispatch({ type: 'CLEAR_STATUS_BANNER' });
          }, event.ttlMs);
        }

        return;
      }

      if (event.type === 'checkpoint.cleaned') {
        dispatch({
          type: 'FINALIZE_INTERRUPT',
          payload: { timestamp: event.timestamp || new Date() },
        });

        dispatch({
          type: 'SET_STATUS_BANNER',
          payload: { face: KAOMOJI.cleanupDone, label: '', source: 'runtime' },
        });
        if (statusBannerTimerRef.current) clearTimeout(statusBannerTimerRef.current);
        statusBannerTimerRef.current = setTimeout(() => {
          dispatch({ type: 'CLEAR_STATUS_BANNER', payload: { source: 'runtime' } });
        }, 2000);
        return;
      }

      // Intercept cancellation errors and treat them as interrupts
      // This ensures we show the "^C [SPLATTED]" style instead of a generic error
      const cancellationToken = 'Operation cancelled by user';
      const messageText = typeof event.message === 'string' ? event.message : '';
      const isCancellation =
        (event.type === 'error' && event.error?.message === 'Operation cancelled by user') ||
        messageText.includes(cancellationToken) ||
        (typeof event.error === 'string' && event.error.includes('Operation cancelled by user'));

      if (isCancellation) {
        const trimmed = messageText.trim();
        const interruptContent =
          trimmed === cancellationToken || trimmed === `Failed: ${cancellationToken}`
            ? ''
            : trimmed;
        dispatch({
          type: 'INTERRUPT_STREAM',
          payload: {
            content: interruptContent,
            timestamp: event.timestamp || new Date(),
          },
        });
        return;
      }

      if (event.type === 'llm.stream.delta') {
        const delta = sanitizeMessage({ type: 'assistant', content: event.content });
        if (!delta) return;

        if (activeStreamIdRef.current && activeStreamIdRef.current !== event.streamId) {
          flushStream(activeStreamIdRef.current);
          dispatch({ type: 'COMPLETE_STREAM', payload: { id: activeStreamIdRef.current } });
        }
        activeStreamIdRef.current = event.streamId;

        // Use throttled dispatch instead of direct dispatch
        throttledStreamDispatch(event.streamId, delta, event.timestamp || new Date());
        return;
      }

      if (event.type === 'llm.stream.end') {
        flushStream(event.streamId);
        dispatch({ type: 'COMPLETE_STREAM', payload: { id: event.streamId } });
        if (activeStreamIdRef.current === event.streamId) activeStreamIdRef.current = null;
        return;
      }

      // For all non-streaming events, flush pending streams first to maintain chronological order
      // This prevents throttled stream messages from appearing AFTER events that occurred earlier
      flushAllStreams();

      if (event.type === 'retry') {
        const fromAttempt = typeof event.fromAttempt === 'number' ? event.fromAttempt : 0;
        const toAttempt = typeof event.toAttempt === 'number' ? event.toAttempt : fromAttempt + 1;
        const reason = typeof event.reason === 'string' ? event.reason : '';

        dispatchSanitizedMessage({
          type: 'warning',
          content: text.loop.retryingAttempt(fromAttempt, toAttempt, reason),
          timestamp: event.timestamp,
        });
        return;
      }

      if (event.type === 'llm.output') {
        // Full output message (non-streaming path).
        dispatchSanitizedMessage({
          type: 'assistant',
          content: event.content,
          timestamp: event.timestamp,
        });
        return;
      }
      if (event.type === 'log') {
        const msg = event.message || '';
        const level = String(event.level || 'info');
        if (logMode === 'quiet' || logMode === 'normal') {
          if (level !== 'warn' && level !== 'error') {
            return;
          }
        }
        const type =
          event.level === 'error' ? 'error' : event.level === 'warn' ? 'warning' : 'system';
        const content = mapErrorForDisplay({ message: msg, code: event.code }).message;

        dispatchSanitizedMessage({ content, type, timestamp: event.timestamp });
      } else if (event.type === 'snapshot.created') {
        // Handle structured snapshot event
        if (logMode === 'quiet') return;
        dispatchSanitizedMessage({
          type: 'checkpoint',
          content: event.commitHash.slice(0, 8),
          timestamp: event.timestamp,
        });
      } else if (event.content || event.message) {
        if (logMode === 'debug') {
          dispatchSanitizedMessage(event);
        }
      }

      switch (event.type) {
        case 'phase.start': {
          dispatch({ type: 'UPDATE_PHASE', payload: event.phase, status: 'running' });

          // Explicit mapping: Add blue label messages to the UI list when key phases start
          const phaseTypeMap: Record<string, MessageType> = {
            PREFLIGHT: 'preflight_step',
            PREPARE_DEPS: 'preflight_step',
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
            if (logMode !== 'quiet' && logMode !== 'normal' && logMode !== 'debug') break;
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
        case 'phase.end': {
          dispatch({
            type: 'UPDATE_PHASE',
            payload: event.phase,
            status: event.success ? 'success' : 'failed',
          });
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
          if (logMode !== 'quiet' && logMode !== 'normal' && logMode !== 'debug') break;
          dispatchSanitizedMessage({
            type: 'report_step',
            content: text.cli.uiDiffMeta(event.fileCount, event.lineCount),
            timestamp: event.timestamp || new Date(),
          });
          break;
        case 'verify.result':
          if (event.ok) {
            if (logMode !== 'quiet') {
              dispatchSanitizedMessage({
                type: 'verify_step',
                content: text.cli.uiVerifyPassed,
                timestamp: event.timestamp || new Date(),
              });
            }
            break;
          }
          dispatchSanitizedMessage({
            type: 'verify_step',
            content: text.cli.uiVerifyFailed,
            timestamp: event.timestamp || new Date(),
          });
          if (typeof event.output === 'string' && event.output.trim()) {
            dispatchSanitizedMessage({
              type: 'error',
              content: event.output,
              timestamp: event.timestamp || new Date(),
            });
          }
          break;
        case 'tool.call.start':
          if (logMode !== 'debug') break;
          dispatchSanitizedMessage({
            type: 'tool_call',
            content: `${event.toolName}`,
            timestamp: event.timestamp || new Date(),
            metadata: { toolName: event.toolName, phase: event.phase, callId: event.callId },
          });
          break;
        case 'tool.call.end': {
          const status = String(event.status || 'unknown');
          const isFailure = status !== 'ok';
          if (logMode !== 'debug') {
            if (!isFailure) break;

            dispatchSanitizedMessage({
              type: 'warning',
              content: text.cli.uiToolFailed(String(event.toolName || 'tool'), status),
              timestamp: event.timestamp || new Date(),
            });
            break;
          }
          const durationText =
            typeof event.durationMs === 'number' ? ` (${Math.round(event.durationMs)}ms)` : '';
          const errorText = event.errorCode ? ` code=${event.errorCode}` : '';
          dispatchSanitizedMessage({
            type: 'tool_result',
            content: `${event.toolName}: ${status}${durationText}${errorText}`,
            timestamp: event.timestamp || new Date(),
            metadata: {
              toolName: event.toolName,
              phase: event.phase,
              callId: event.callId,
              status,
              errorCode: event.errorCode,
              durationMs: event.durationMs,
            },
          });
          break;
        }
      }
    },
    [dispatch, dispatchSanitizedMessage, throttledStreamDispatch, flushAllStreams],
  );

  useEffect(() => {
    if (mode === 'run') {
      if (runStartedRef.current) return;
      runStartedRef.current = true;
      onStart((event: any) => handleEvent(event), { signal });
    }
  }, [mode, onStart, signal, handleEvent]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (statusBannerTimerRef.current) {
        clearTimeout(statusBannerTimerRef.current);
        statusBannerTimerRef.current = null;
      }
      streamTimerRef.current.forEach((timer) => clearTimeout(timer));
      streamTimerRef.current.clear();
      streamBufferRef.current.clear();
    };
  }, []);

  return { sanitizeAndDispatch: handleEvent };
}
