import { runSalmonLoop } from '../core/loop.js';
import { ChatSessionManager } from '../core/session/manager.js';
import type { CheckpointStrategy, LLM } from '../core/types.js';
import { text } from '../locales/index.js';

import { findCommand } from './commands/registry.js';
import { startGUI } from './ui/index.js';

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

  // Load or create session
  let session = options.resume ? await sessionManager.loadLast() : null;
  if (!session) {
    session = await sessionManager.create();
  }

  await startGUI('chat', async (emit, input) => {
    if (input === undefined) return;
    const trimmed = input.trim();

    // Check for slash commands
    const command = findCommand(trimmed);
    if (command) {
      await command.execute({ emit, sessionManager, input: trimmed });
      return;
    }

    // Safety fallback: prevent unknown slash commands from leaking to LLM
    if (trimmed.startsWith('/')) {
      emit({
        type: 'log',
        level: 'error',
        message: `Unknown command: ${trimmed.split(' ')[0]}. Type /help for available commands.`,
        timestamp: new Date(),
      });
      return;
    }

    // Add user message
    sessionManager.addMessage({
      role: 'user',
      content: input,
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
  });
}
