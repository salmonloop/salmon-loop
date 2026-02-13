import * as readline from 'readline';

import chalk from 'chalk';

import { logger } from '../core/observability/logger.js';

import { text } from './locales/index.js';

/**
 * Handles interruptions (Ctrl+C, ESC) for chat mode.
 */
export class ChatInterface {
  private sigintHandler: NodeJS.SignalsListener | null = null;
  private keypressHandler: ((str: string, key: readline.Key) => void) | null = null;
  private abortController: AbortController | null = null;

  /**
   * Set the current AbortController for task interruption
   */
  setAbortController(controller: AbortController | null): void {
    this.abortController = controller;
  }

  /**
   * Start listening for interruption keys (Ctrl+C, ESC) during task execution.
   */
  startTaskListener(onInterrupt: () => void): () => void {
    const isTTY = process.stdin.isTTY;

    if (isTTY) {
      // TTY mode: Use Raw Mode + Keypress to catch ESC and Ctrl+C
      process.stdin.setRawMode(true);
      process.stdin.resume();
      readline.emitKeypressEvents(process.stdin);

      this.keypressHandler = (_str: string, key: readline.Key) => {
        // Ctrl+C
        if (key.ctrl && key.name === 'c') {
          this.handleInterrupt(onInterrupt, 'Ctrl+C');
          return;
        }

        // ESC
        if (key.name === 'escape') {
          this.handleInterrupt(onInterrupt, 'ESC');
          return;
        }
      };

      process.stdin.on('keypress', this.keypressHandler!);
    } else {
      // Non-TTY mode: Fallback to standard SIGINT
      this.sigintHandler = () => {
        this.handleInterrupt(onInterrupt, 'SIGINT');
      };
      process.on('SIGINT', this.sigintHandler);
    }

    return () => this.cleanup();
  }

  /**
   * Handle the interruption signal
   */
  private handleInterrupt(onInterrupt: () => void, _source: string): void {
    if (this.abortController && !this.abortController.signal.aborted) {
      // Only log if we're actually aborting a new signal
      logger.log(chalk.yellow(`\n${text.cli.chatTaskInterrupted}`));
      this.abortController.abort();
      onInterrupt();
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    // Cleanup Keypress
    if (this.keypressHandler) {
      process.stdin.off('keypress', this.keypressHandler);
      this.keypressHandler = null;
    }

    // Cleanup SIGINT
    if (this.sigintHandler) {
      process.off('SIGINT', this.sigintHandler);
      this.sigintHandler = null;
    }

    // Restore TTY state
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      // Do not pause stdin as inquirer will need it immediately after
    }
  }
}
