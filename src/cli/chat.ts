import type { ToolAuthorizationConfig } from '../core/config/index.js';
import { logger } from '../core/logger.js';
import { runSalmonLoop } from '../core/loop.js';
import { ChatSessionManager } from '../core/session/manager.js';
import type { CheckpointStrategy, LLM, LoopEvent } from '../core/types.js';

import { createUiAuthorizationProvider } from './authorization/provider.js';
import { CommandDispatcher } from './commands/dispatcher.js';
import type { QueueController } from './commands/types.js';
import { CHAT_QUEUE_CONFIG } from './config.js';
import { text } from './locales/index.js';
import type { GUIOptions } from './ui/index.js';
import { createAsyncQueue } from './utils/asyncQueue.js';

export interface ChatModeOptions {
  repoPath: string;
  llm: LLM;
  verifyCommand?: string;
  checkpointStrategy?: CheckpointStrategy;
  resume?: boolean;
  verbose?: boolean;
  toolAuthorization?: ToolAuthorizationConfig;
}

/**
 * Start interactive chat mode
 */
export async function startChatMode(options: ChatModeOptions): Promise<void> {
  const sessionManager = new ChatSessionManager(options.repoPath);
  await sessionManager.init();
  const dispatcher = new CommandDispatcher();

  // Load or create session
  let session = options.resume ? await sessionManager.loadLast() : null;
  if (!session) {
    session = await sessionManager.create();
  }

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

  const authorizationProvider = createUiAuthorizationProvider({
    emit: (event) => {
      latestEmit?.({ ...event, timestamp: new Date() });
    },
    config: options.toolAuthorization,
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
    return /aborted|cancelled|canceled|interrupted/i.test(error.message);
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

      // Add user message
      sessionManager.addMessage({
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      });

      const result = await withTimeout(
        runSalmonLoop({
          instruction: trimmed,
          verify: options.verifyCommand,
          repoPath: options.repoPath,
          llm: options.llm,
          strategy: options.checkpointStrategy || 'worktree',
          verbose: options.verbose ? 'basic' : undefined,
          onEvent: latestEmit,
          signal: latestGuiOptions?.signal,
          authorizationProvider,
        }),
        CHAT_QUEUE_CONFIG.TASK_TIMEOUT_MS,
      );

      if (!result.success && isInterruptResult(result.reason)) {
        markInterrupted(trimmed);
      }

      // Add assistant message & iteration info
      const responseText = result.success
        ? text.cli.chatSuccess(result.changedFiles?.join(', ') || 'none')
        : text.cli.chatFailed(result.reason);

      sessionManager.addMessage({
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      });

      if (result.history && result.history.length > 0) {
        sessionManager.addIteration(result.history[result.history.length - 1]);
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
    },
    resume: () => {
      queue.resume();
      lastInterruptedInput = null;
    },
    clear: () => {
      const cleared = queue.clear();
      lastInterruptedInput = null;
      latestDispatch?.({ type: 'CLEAR_QUEUE_MESSAGES' });
      logger.audit('QUEUE_CLEAR', { source: 'chat', cleared });
      return cleared;
    },
    retry: () => {
      if (!lastInterruptedInput) return false;
      const retryInput = lastInterruptedInput;
      lastInterruptedInput = null;
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

  const withTimeout = async <T>(promise: Promise<T>, timeoutMs?: number) => {
    if (!timeoutMs) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
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
      if (input === undefined) return;
      latestDispatch = dispatch || (() => {});
      latestEmit = emit;
      latestGuiOptions = guiOptions;

      const dispatchResult = await dispatcher.dispatch(input, {
        emit,
        sessionManager,
        dispatch: latestDispatch || (() => {}),
        queue: queueController,
        toolAuthorization: options.toolAuthorization,
      });

      if (dispatchResult.type === 'executed' || dispatchResult.type === 'blocked') {
        return;
      }

      const trimmed = dispatchResult.trimmedInput;
      if (!trimmed) return;

      return enqueueInput(trimmed);
    },
  );
}
