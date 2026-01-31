import chalk from 'chalk';

import { logger } from '../core/logger.js';
import { runSalmonLoop } from '../core/loop.js';
import { ChatSessionManager } from '../core/session/manager.js';
import type { ChatSession } from '../core/session/types.js';
import type { CheckpointStrategy, LLM } from '../core/types.js';
import { text } from '../locales/index.js';
import { startGUI } from './ui/index.js';

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
    if (trimmed === '/exit' || trimmed === '/quit') {
      process.exit(0);
    }

    if (trimmed === '/status') {
      const statusMsg = [
        `Session: ${session.meta.name}`,
        `ID: ${session.meta.id.slice(0, 8)}`,
        `Iterations: ${session.meta.totalIterations} (${session.meta.successfulIterations} ok)`,
        `Messages: ${session.messages.length}`,
      ].join(' | ');
      emit({ type: 'log', level: 'info', message: statusMsg, timestamp: new Date() });
      return;
    }

    if (trimmed === '/clear') {
      emit({ type: 'checkpoint.created', worktreePath: '', baseRef: '', timestamp: new Date() }); // Hack to trigger clear in UI
      return;
    }

    if (trimmed === '/history') {
      session.iterations.forEach((iter, i) => {
        const status = iter.error ? '✗' : '✓';
        emit({
          type: 'log',
          level: 'info',
          message: `#${i + 1} ${status} - ${iter.contextSummary || 'No context'}`,
          timestamp: new Date(),
        });
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
