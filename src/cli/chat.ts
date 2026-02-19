import { runAnswerExecutor } from '../core/answer/answer-executor.js';
import type {
  MarkdownRenderMode,
  MarkdownTheme,
  ToolAuthorizationConfig,
} from '../core/config/index.js';
import type { ResolvedExtensions } from '../core/extensions/types.js';
import { InputHistoryManager } from '../core/history/input-history.js';
import { routeChatIntent } from '../core/intent/chat-intent.js';
import { DEFAULT_LLM_OUTPUT_POLICY, emitLlmOutput } from '../core/llm/output-policy.js';
import { logIgnoredError } from '../core/observability/ignored-error.js';
import { logger } from '../core/observability/logger.js';
import type { RunOutcomeReporter } from '../core/observability/run-outcome-reporter.js';
import { runSalmonLoop } from '../core/runtime/loop.js';
import { ChatSessionManager } from '../core/session/manager.js';
import { TokenTracker } from '../core/session/token-tracker.js';
import type { CheckpointStrategy, LLM, LoopEvent, LlmOutputPolicy } from '../core/types/index.js';

import { createUiAuthorizationProvider } from './authorization/provider.js';
import { commands } from './commands/registry.js';
import type { QueueController } from './commands/types.js';
import { CHAT_QUEUE_CONFIG } from './config.js';
import { text } from './locales/index.js';
import { createCliSlashRuntime } from './slash/runtime.js';
import type { GUIOptions } from './ui/index.js';
import { createAsyncQueue } from './utils/asyncQueue.js';

export interface ChatModeOptions {
  repoPath: string;
  llm: LLM;
  verifyCommand?: string;
  checkpointStrategy?: CheckpointStrategy;
  resume?: boolean;
  verbose?: boolean;
  llmOutput?: LlmOutputPolicy;
  markdownTheme?: MarkdownTheme;
  markdownRenderMode?: MarkdownRenderMode;
  toolAuthorization?: ToolAuthorizationConfig;
  extensions?: ResolvedExtensions;
  outcomeReporter?: RunOutcomeReporter;
  /**
   * Optional override. If unset, chat mode will use the local chat session id.
   */
  langfuseSessionId?: string;
  langfuseUserId?: string;
}

/**
 * Start interactive chat mode
 */
export async function startChatMode(options: ChatModeOptions): Promise<void> {
  const sessionManager = new ChatSessionManager(options.repoPath);
  await sessionManager.init();
  const historyManager = new InputHistoryManager(options.repoPath);
  await historyManager.init();

  // Load or create session
  let session = options.resume ? await sessionManager.loadLast() : null;
  if (!session) {
    session = await sessionManager.create();
  }

  // Load input history for this session
  const inputHistory = await historyManager.load(session.meta.id);

  // Dynamically import GUI to avoid top-level await issues with yoga-layout
  const { startGUI } = await import('./ui/index.js');

  let latestDispatch: ((action: any) => void) | undefined;
  let latestEmit: ((event: LoopEvent) => void) | undefined;
  let latestGuiOptions: GUIOptions | undefined;
  let thinkingTimer: NodeJS.Timeout | null = null;
  let thinkingVisibleAt: number | null = null;
  let hideTimer: NodeJS.Timeout | null = null;
  let currentInstruction: string | null = null;
  let lastInterruptedInput: string | null = null;
  let currentLlmOutputPolicy = options.llmOutput ?? DEFAULT_LLM_OUTPUT_POLICY;

  const authorizationProvider = createUiAuthorizationProvider({
    emit: (event) => {
      latestEmit?.({ ...event, timestamp: new Date() });
    },
    config: options.toolAuthorization,
  });

  const slashRuntime = await createCliSlashRuntime({
    repoRoot: options.repoPath,
    baseCommands: commands,
    emit: (event) => {
      latestEmit?.({ ...event, timestamp: new Date() });
    },
    authorizationProvider,
    skillDiscovery: options.extensions?.skillDiscovery,
  });

  const setThinking = (value: boolean) => {
    if (!latestDispatch) return;
    latestDispatch({ type: 'SET_THINKING', payload: value });
  };

  const handleThinkingState = (desired: boolean) => {
    if (desired) {
      if (thinkingVisibleAt !== null) return;
      if (thinkingTimer) clearTimeout(thinkingTimer);
      thinkingTimer = setTimeout(() => {
        thinkingVisibleAt = Date.now();
        setThinking(true);
        thinkingTimer = null;
      }, CHAT_QUEUE_CONFIG.THINKING_SHOW_DELAY_MS);
      return;
    }

    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
      thinkingTimer = null;
    }

    if (thinkingVisibleAt === null) return;

    const elapsed = Date.now() - thinkingVisibleAt;
    const remaining = CHAT_QUEUE_CONFIG.THINKING_MIN_VISIBLE_MS - elapsed;
    if (hideTimer) clearTimeout(hideTimer);
    if (remaining > 0) {
      hideTimer = setTimeout(() => {
        thinkingVisibleAt = null;
        setThinking(false);
        hideTimer = null;
      }, remaining);
      return;
    }

    thinkingVisibleAt = null;
    setThinking(false);
  };

  const queue = createAsyncQueue(
    (state) => {
      if (!latestDispatch) return;
      handleThinkingState(state.isProcessing || state.pendingCount > 0);
    },
    {
      maxSize: CHAT_QUEUE_CONFIG.MAX_SIZE,
      overflowStrategy: CHAT_QUEUE_CONFIG.OVERFLOW_STRATEGY,
    },
  );

  const isInterruptError = (error: unknown) => {
    if (!(error instanceof Error)) return false;
    return /aborted|cancelled|canceled|interrupted|timed out|timeout/i.test(error.message);
  };

  const isInterruptResult = (reason: string | undefined) => {
    if (!reason) return false;
    return /cancelled by user/i.test(reason);
  };

  const markInterrupted = (input: string) => {
    lastInterruptedInput = input;
    queue.pause();
    latestEmit?.({
      type: 'log',
      level: 'info',
      message: text.cli.queuePausedAfterInterrupt,
      timestamp: new Date(),
    });
  };

  const enqueueInput = (input: string, queueOptions?: { front?: boolean }) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (!latestDispatch) return;

    try {
      const currentSessionId = sessionManager.getCurrent().meta.id;
      historyManager
        .append(currentSessionId, trimmed)
        .catch((error) => logIgnoredError('[History] append failed', error));
    } catch {
      // Best-effort: persistence should never block interactive input.
    }

    const queueMessageId = `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const queueState = queue.getState();
    if (
      typeof CHAT_QUEUE_CONFIG.MAX_SIZE === 'number' &&
      CHAT_QUEUE_CONFIG.MAX_SIZE >= 0 &&
      queueState.pendingCount >= CHAT_QUEUE_CONFIG.MAX_SIZE &&
      CHAT_QUEUE_CONFIG.OVERFLOW_STRATEGY === 'drop_oldest'
    ) {
      latestDispatch({ type: 'SHIFT_QUEUE_MESSAGE' });
    }

    latestDispatch({
      type: 'ADD_QUEUE_MESSAGE',
      payload: {
        id: queueMessageId,
        content: trimmed,
        timestamp: new Date(),
      },
    });

    const enqueueFn = queueOptions?.front ? queue.enqueueFront : queue.enqueue;
    let started = false;

    return enqueueFn(async () => {
      started = true;
      latestDispatch?.({ type: 'SHIFT_QUEUE_MESSAGE' });
      currentInstruction = trimmed;
      const timeoutAbort = new AbortController();
      const mergedSignal = mergeAbortSignals([latestGuiOptions?.signal, timeoutAbort.signal]);

      // Add user message
      sessionManager.addMessage({
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      });

      const execution = await withTimeout(
        (async () => {
          const intentDecision = await routeChatIntent(trimmed, {
            llm: options.llm,
            signal: mergedSignal.signal,
          });

          latestEmit?.({
            type: 'log',
            level: 'info',
            message: text.cli.chatIntentRouted(
              intentDecision.intent,
              intentDecision.confidence,
              intentDecision.reason,
            ),
            timestamp: new Date(),
          });

          if (intentDecision.intent === 'answer') {
            const answer = await runAnswerExecutor({
              repoPath: options.repoPath,
              llm: options.llm,
              instruction: trimmed,
              emit: latestEmit,
              signal: mergedSignal.signal,
              llmOutputPolicy: currentLlmOutputPolicy,
              authorizationProvider,
              authorizationMode: 'deferred',
            });

            const responseText = answer.content?.trim() ? answer.content : text.cli.chatAnswerEmpty;

            sessionManager.addMessage({
              role: 'assistant',
              content: responseText,
              timestamp: Date.now(),
            });

            await sessionManager.save();
            return { kind: 'answer' as const };
          }

          const strategy =
            intentDecision.intent === 'review'
              ? 'direct'
              : options.checkpointStrategy || 'worktree';

          const result = await runSalmonLoop({
            instruction: trimmed,
            verify: options.verifyCommand,
            repoPath: options.repoPath,
            llm: options.llm,
            mode: intentDecision.intent,
            strategy,
            verbose: options.verbose ? 'basic' : undefined,
            onEvent: latestEmit,
            signal: mergedSignal.signal,
            llmOutput: currentLlmOutputPolicy,
            outcomeReporter: options.outcomeReporter,
            // Resolve sessionId at call time to support `/session` switching.
            langfuseSessionId: options.langfuseSessionId || sessionManager.getCurrent().meta.id,
            langfuseUserId: options.langfuseUserId,
            authorizationProvider,
            authorizationMode: 'deferred',
          });

          return { kind: 'flow' as const, mode: intentDecision.intent, result };
        })(),
        CHAT_QUEUE_CONFIG.TASK_TIMEOUT_MS,
        () => timeoutAbort.abort(),
      ).finally(() => {
        mergedSignal.cleanup();
      });

      if (execution.kind === 'answer') {
        currentInstruction = null;
        return { ok: true, kind: 'answer' as const };
      }

      const result = execution.result;
      const mode = execution.mode;

      if (!result.success && isInterruptResult(result.reason)) {
        markInterrupted(trimmed);
      }

      // Add assistant message & iteration info
      const changedFiles = result.changedFiles ?? [];
      const responseText = result.success
        ? mode === 'review'
          ? text.cli.chatReviewCompleted
          : changedFiles.length === 0
            ? text.cli.chatNoChanges
            : text.cli.chatSuccess(changedFiles.join(', '))
        : text.cli.chatFailed(result.reason);

      emitLlmOutput({
        emit: latestEmit,
        policy: currentLlmOutputPolicy,
        kind: 'assistant_message',
        step: 'REPORT',
        content: responseText,
      });

      sessionManager.addMessage({
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      });

      if (result.history && result.history.length > 0) {
        sessionManager.addIteration(result.history[result.history.length - 1]);
      }

      const usage = await TokenTracker.extractFromResult(result);
      if (usage) {
        TokenTracker.accumulate(sessionManager.getCurrent(), usage);
      }

      await sessionManager.save();
      currentInstruction = null;
      return result;
    }).catch((error) => {
      if (!started) {
        latestDispatch?.({ type: 'REMOVE_QUEUE_MESSAGE', payload: { id: queueMessageId } });
      }
      if (isInterruptError(error) && currentInstruction) {
        markInterrupted(currentInstruction);
      }
      currentInstruction = null;
      throw error;
    });
  };

  const queueController: QueueController = {
    pause: () => {
      queue.pause();
      logger.audit(
        'QUEUE_PAUSE',
        { status: 'paused' },
        { source: 'chat', severity: 'low', scope: 'session' },
      );
    },
    resume: () => {
      queue.resume();
      lastInterruptedInput = null;
      logger.audit(
        'QUEUE_RESUME',
        { status: 'resumed' },
        { source: 'chat', severity: 'low', scope: 'session' },
      );
    },
    clear: () => {
      const cleared = queue.clear();
      lastInterruptedInput = null;
      latestDispatch?.({ type: 'CLEAR_QUEUE_MESSAGES' });
      logger.audit(
        'QUEUE_CLEAR',
        { cleared },
        { source: 'chat', severity: 'low', scope: 'session' },
      );
      return cleared;
    },
    retry: () => {
      if (!lastInterruptedInput) return false;
      const retryInput = lastInterruptedInput;
      lastInterruptedInput = null;
      queue.resume();
      enqueueInput(retryInput, { front: true });
      return true;
    },
    status: () => {
      const state = queue.getState();
      return {
        pendingCount: state.pendingCount,
        isProcessing: state.isProcessing,
        isPaused: state.isPaused,
        hasInterrupted: Boolean(lastInterruptedInput),
        interruptedInput: lastInterruptedInput || undefined,
      };
    },
  };

  const mergeAbortSignals = (signals: Array<AbortSignal | undefined>) => {
    const controller = new AbortController();
    const listeners: Array<{ signal: AbortSignal; handler: () => void }> = [];

    const abort = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };

    for (const signal of signals) {
      if (!signal) continue;
      if (signal.aborted) {
        abort();
        break;
      }
      const handler = () => abort();
      signal.addEventListener('abort', handler, { once: true });
      listeners.push({ signal, handler });
    }

    const cleanup = () => {
      for (const { signal, handler } of listeners) {
        signal.removeEventListener('abort', handler);
      }
    };

    return { signal: controller.signal, cleanup };
  };

  const withTimeout = async <T>(
    promise: Promise<T>,
    timeoutMs?: number,
    onTimeout?: () => void,
  ) => {
    if (!timeoutMs) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error('Chat task timed out'));
      }, timeoutMs);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  };

  await startGUI(
    'chat',
    sessionManager,
    async (
      emit: (ev: LoopEvent) => void,
      input: string | undefined,
      guiOptions: GUIOptions | undefined,
      dispatch: ((action: any) => void) | undefined,
    ) => {
      if (input === undefined) {
        latestDispatch = dispatch || (() => {});
        latestEmit = emit;
        latestGuiOptions = guiOptions;
        // First run: load history into store
        if (dispatch && session) {
          dispatch({ type: 'SET_INPUT_HISTORY', payload: inputHistory });
        }
        return;
      }
      latestDispatch = dispatch || (() => {});
      latestEmit = emit;
      latestGuiOptions = guiOptions;

      const dispatchResult = await slashRuntime.dispatch(input, {
        emit,
        sessionManager,
        input,
        dispatch: latestDispatch || (() => {}),
        queue: queueController,
        toolAuthorization: options.toolAuthorization,
        getLlmOutputPolicy: () => currentLlmOutputPolicy,
        setLlmOutputPolicy: (policy) => {
          currentLlmOutputPolicy = policy;
        },
        // Expose UI abort signal to slash handlers (e.g. tool authorization waits).
        signal: latestGuiOptions?.signal,
      });

      if (dispatchResult.type === 'executed' || dispatchResult.type === 'blocked') {
        return;
      }

      const trimmed = dispatchResult.trimmedInput;
      if (!trimmed) return;

      return enqueueInput(trimmed);
    },
    {
      markdownTheme: options.markdownTheme,
      markdownRenderMode: options.markdownRenderMode,
      findCommand: (name: string) => slashRuntime.findCommand(name),
      getSuggestions: async (input: string) => {
        if (!latestEmit || !latestDispatch) return [];
        return slashRuntime.getSuggestions(input, {
          emit: latestEmit,
          sessionManager,
          input,
          dispatch: latestDispatch,
          queue: queueController,
          toolAuthorization: options.toolAuthorization,
          getLlmOutputPolicy: () => currentLlmOutputPolicy,
          setLlmOutputPolicy: (policy) => {
            currentLlmOutputPolicy = policy;
          },
          signal: latestGuiOptions?.signal,
        });
      },
    },
  );
}
