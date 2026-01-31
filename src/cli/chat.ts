import { input } from '@inquirer/prompts';
import chalk from 'chalk';

import { logger } from '../core/logger.js';
import { runSalmonLoop } from '../core/loop.js';
import { ChatSessionManager } from '../core/session/manager.js';
import type { ChatSession } from '../core/session/types.js';
import type { CheckpointStrategy, LLM } from '../core/types.js';
import { text } from '../locales/index.js';

import { ChatInterface } from './chat-interface.js';

export interface ChatModeOptions {
  repoPath: string;
  llm: LLM;
  verifyCommand: string;
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

  const chatInterface = new ChatInterface();

  // Load or create session
  let session;
  if (options.resume) {
    session = await sessionManager.loadLast();
    if (session) {
      logger.log(chalk.green(text.cli.chatResumed(session.meta.name)));
      logger.log(
        chalk.dim(text.cli.chatLastUpdated(new Date(session.meta.updatedAt).toLocaleString())),
      );
      logger.log(chalk.dim(text.cli.chatIterations(session.meta.totalIterations) + '\n'));
    } else {
      logger.log(chalk.yellow(text.cli.chatNoPreviousSession + '\n'));
      session = await sessionManager.create();
    }
  } else {
    session = await sessionManager.create();
    logger.log(chalk.blue(text.cli.chatNewSession(session.meta.id.slice(0, 8)) + '\n'));
  }

  logger.log(chalk.cyan(text.cli.chatCommands));
  logger.log(chalk.dim(text.cli.chatCommandExit));
  logger.log(chalk.dim(text.cli.chatCommandStatus));
  logger.log(chalk.dim(text.cli.chatCommandClear));
  logger.log(chalk.dim(text.cli.chatCommandHistory + '\n'));

  let shouldExit = false;
  let lastSigintTime = 0;
  const doublePressWindow = 500;

  // REPL loop
  while (!shouldExit) {
    try {
      let userInput: string;
      try {
        userInput = await input({
          message: text.cli.chatPrompt,
        });
      } catch (error) {
        if ((error as any)?.message?.includes('User force closed')) {
          const now = Date.now();
          if (now - lastSigintTime < doublePressWindow) {
            shouldExit = true;
            logger.log(chalk.green(`\n${text.cli.chatSessionSaved}`));
            break;
          } else {
            logger.log(chalk.yellow(`\n${text.cli.chatExitHint}`));
            lastSigintTime = now;
            continue;
          }
        }
        throw error;
      }

      const trimmed = userInput.trim();
      if (!trimmed) continue;

      // Handle commands
      if (trimmed === '/exit' || trimmed === '/quit') {
        logger.log(chalk.green(text.cli.chatSessionSaved));
        break;
      }

      if (trimmed === '/status') {
        printStatus(session);
        continue;
      }

      if (trimmed === '/clear') {
        logger.clear();
        continue;
      }

      if (trimmed === '/history') {
        printHistory(session);
        continue;
      }

      // Add user message
      sessionManager.addMessage({
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      });

      // Execute SalmonLoop
      logger.log(chalk.dim(text.cli.chatThinking + '\n'));

      // Create AbortController for this task
      const abortController = new AbortController();
      chatInterface.setAbortController(abortController);

      let taskInterrupted = false;
      const handleInterrupt = () => {
        taskInterrupted = true;
      };

      // Start listening for Ctrl+C during task execution
      const stopTaskListener = chatInterface.startTaskListener(handleInterrupt);

      const result = await runSalmonLoop({
        instruction: trimmed,
        verify: options.verifyCommand,
        repoPath: options.repoPath,
        llm: options.llm,
        strategy: options.checkpointStrategy || 'worktree',
        verbose: options.verbose ? 'basic' : undefined,
        signal: abortController.signal,
        onEvent: (event) => {
          if (event.type === 'phase.start') {
            logger.log(chalk.dim(`  ${event.phase}...`));
          }
        },
      });

      // Stop task listener
      stopTaskListener();
      chatInterface.setAbortController(null);

      // Skip adding to session if task was interrupted
      if (taskInterrupted) {
        continue;
      }

      // Add iteration
      if (result.history && result.history.length > 0) {
        const lastIter = result.history[result.history.length - 1];
        sessionManager.addIteration(lastIter);

        if (result.success) {
          session.meta.successfulIterations++;
        }
      }

      // Add assistant message
      const responseText = result.success
        ? text.cli.chatSuccess(result.changedFiles?.join(', ') || 'none')
        : text.cli.chatFailed(result.reason);

      sessionManager.addMessage({
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      });

      logger.log(result.success ? chalk.green(responseText) : chalk.red(responseText));
      logger.log('');

      // Save session
      await sessionManager.save();
    } catch (error) {
      // Handle errors gracefully
      // User force closed is handled in the inner try-catch block

      logger.error(chalk.red('Error: ') + (error instanceof Error ? error.message : String(error)));
    }
  }

  // Cleanup
  chatInterface.cleanup();
}

function printStatus(session: ChatSession): void {
  logger.log(chalk.bold('\nSession Status:'));
  logger.log(`  ID: ${session.meta.id}`);
  logger.log(`  Name: ${session.meta.name}`);
  logger.log(
    `  Iterations: ${session.meta.totalIterations} (${session.meta.successfulIterations} successful)`,
  );
  logger.log(`  Messages: ${session.messages.length}`);
  logger.log(`  Snapshots: ${session.meta.snapshots.length}`);
  logger.log(`  Tokens: ${session.meta.totalTokens.input + session.meta.totalTokens.output}\n`);
}

function printHistory(session: ChatSession): void {
  logger.log(chalk.bold('\nIteration History:'));
  session.iterations.forEach((iter, i) => {
    const status = iter.error ? chalk.red('✗') : chalk.green('✓');
    logger.log(`  ${status} #${i + 1} - ${iter.contextSummary || 'No context'}`);
    if (iter.error) {
      logger.log(chalk.dim(`      Error: ${iter.error.substring(0, 80)}...`));
    }
  });
  logger.log('');
}
