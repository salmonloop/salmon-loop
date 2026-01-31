import { input } from '@inquirer/prompts';
import chalk from 'chalk';

import { logger } from '../core/logger.js';
import { runSalmonLoop } from '../core/loop.js';
import { ChatSessionManager } from '../core/session/manager.js';
import type { ChatSession } from '../core/session/types.js';
import type { CheckpointStrategy, LLM } from '../core/types.js';

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

  // Load or create session
  let session;
  if (options.resume) {
    session = await sessionManager.loadLast();
    if (session) {
      logger.log(chalk.green(`✨ Resumed: ${session.meta.name}`));
      logger.log(
        chalk.dim(`   Last updated: ${new Date(session.meta.updatedAt).toLocaleString()}`),
      );
      logger.log(chalk.dim(`   Iterations: ${session.meta.totalIterations}\n`));
    } else {
      logger.log(chalk.yellow('No previous session found. Starting new one.\n'));
      session = await sessionManager.create();
    }
  } else {
    session = await sessionManager.create();
    logger.log(chalk.blue(`🚀 New session: ${session.meta.id.slice(0, 8)}\n`));
  }

  logger.log(chalk.cyan('Commands:'));
  logger.log(chalk.dim('  /exit, /quit  - Exit chat'));
  logger.log(chalk.dim('  /status       - Show session info'));
  logger.log(chalk.dim('  /clear        - Clear screen'));
  logger.log(chalk.dim('  /history      - Show iteration history\n'));

  // REPL loop
  while (true) {
    try {
      const userInput = await input({
        message: chalk.cyan('s8p>'),
      });

      const trimmed = userInput.trim();
      if (!trimmed) continue;

      // Handle commands
      if (trimmed === '/exit' || trimmed === '/quit') {
        logger.log(chalk.green('👋 Session saved. Goodbye!'));
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
      logger.log(chalk.dim('Thinking...\n'));

      const result = await runSalmonLoop({
        instruction: trimmed,
        verify: options.verifyCommand,
        repoPath: options.repoPath,
        llm: options.llm,
        strategy: options.checkpointStrategy || 'worktree',
        verbose: options.verbose ? 'basic' : undefined,
        onEvent: (event) => {
          if (event.type === 'phase.start') {
            logger.log(chalk.dim(`  ${event.phase}...`));
          }
        },
      });

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
        ? `✅ Changes applied successfully!\n\nFiles changed: ${result.changedFiles?.join(', ') || 'none'}`
        : `❌ Failed: ${result.reason}`;

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
      logger.error(chalk.red('Error: ') + (error instanceof Error ? error.message : String(error)));
    }
  }
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
