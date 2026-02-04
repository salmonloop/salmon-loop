import { runSalmonLoop } from '../core/loop.js';
import { ChatSessionManager } from '../core/session/manager.js';
import type { CheckpointStrategy, LLM, LoopEvent } from '../core/types.js';

import { CommandDispatcher } from './commands/dispatcher.js';
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
  let thinkingTimer: NodeJS.Timeout | null = null;
  let thinkingVisibleAt: number | null = null;
  let hideTimer: NodeJS.Timeout | null = null;

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

      return queue.enqueue(async () => {
        // Dispatch command or get validated input
        const dispatchResult = await dispatcher.dispatch(input, {
          emit,
          sessionManager,
          dispatch: latestDispatch || (() => {}),
        });

        if (dispatchResult.type === 'executed' || dispatchResult.type === 'blocked') {
          return;
        }

        const trimmed = dispatchResult.trimmedInput;

        // Add user message
        sessionManager.addMessage({
          role: 'user',
          content: trimmed, // Use the trimmed input
          timestamp: Date.now(),
        });

        const result = await withTimeout(
          runSalmonLoop({
            instruction: input,
            verify: options.verifyCommand,
            repoPath: options.repoPath,
            llm: options.llm,
            strategy: options.checkpointStrategy || 'worktree',
            verbose: options.verbose ? 'basic' : undefined,
            onEvent: emit,
            signal: guiOptions?.signal,
          }),
          CHAT_QUEUE_CONFIG.TASK_TIMEOUT_MS,
        );

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
        return result;
      });
    },
  );
}
