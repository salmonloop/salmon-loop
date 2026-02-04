import { runSalmonLoop } from '../core/loop.js';
import { ChatSessionManager } from '../core/session/manager.js';
import type { CheckpointStrategy, LLM, LoopEvent } from '../core/types.js';

import { CommandDispatcher } from './commands/dispatcher.js';
import { text } from './locales/index.js';
import type { GUIOptions } from './ui/index.js';

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

      // Dispatch command or get validated input
      const dispatchResult = await dispatcher.dispatch(input, {
        emit,
        sessionManager,
        dispatch: dispatch || (() => {}),
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

      const result = await runSalmonLoop({
        instruction: input,
        verify: options.verifyCommand,
        repoPath: options.repoPath,
        llm: options.llm,
        strategy: options.checkpointStrategy || 'worktree',
        verbose: options.verbose ? 'basic' : undefined,
        onEvent: emit,
        signal: guiOptions?.signal,
      });

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
    },
  );
}
