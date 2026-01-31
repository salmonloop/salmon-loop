import chalk from 'chalk';
import ProgressBar from 'progress';

import { logger } from '../../core/logger.js';
import {
  LoopEvent,
  LoopResult,
  EXECUTION_PHASES,
  Phase,
  ErrorType,
  LLMStreamChunk,
} from '../../core/types.js';
import { text } from '../../locales/index.js';

import { SalmonReporter } from './base.js';

export class StandardReporter implements SalmonReporter {
  private bar: ProgressBar | null = null;

  constructor(private verbose: boolean = false) {}

  onStart(_instruction: string) {
    // In verbose mode, the caller (command handler) usually logs the instruction/config details
    // before calling onStart, or we can do it here if passed more context.
    // For now, we just initialize the progress bar.
    this.initProgressBar();
  }

  onEvent(event: LoopEvent) {
    if (!this.bar) this.initProgressBar();

    switch (event.type) {
      case 'phase.start': {
        const phaseKey = event.phase.toLowerCase() as keyof typeof text.progress;
        const phaseName = text.progress[phaseKey] || event.phase;
        this.bar?.render({ phase: phaseName });
        logger.step(event.phase, phaseName);
        break;
      }
      case 'phase.end': {
        const phaseKey = event.phase.toLowerCase() as keyof typeof text.progress;
        const phaseName = text.progress[phaseKey] || event.phase;
        this.bar?.tick(1, { phase: phaseName });
        break;
      }
      case 'log':
        this.handleLogEvent(event);
        break;
      case 'verify.result':
        if (!event.ok) {
          logger.error('\n' + text.cli.operationFailed);
          logger.debug(event.output);
        }
        break;
      case 'diff.meta':
        logger.success(text.cli.diffMeta(event.fileCount, event.lineCount));
        break;
      case 'retry':
        logger.warn(
          text.cli.retry(
            event.fromAttempt,
            event.toAttempt,
            event.reason.substring(0, 100) + '...',
          ),
        );
        // Reset progress for retry
        this.bar?.terminate();
        this.initProgressBar();
        break;
    }
  }

  onStreamChunk(chunk: LLMStreamChunk) {
    if (chunk?.contentDelta) {
      const delta = chunk.contentDelta;
      if (delta.trim()) {
        this.bar?.interrupt(delta);
      }
    }
  }

  onFinish(result: LoopResult) {
    this.bar?.terminate();
    if (result.success) {
      logger.success(text.cli.operationSuccess);
      logger.log(text.cli.attempts(result.attempts));
    } else {
      this.handleFailure(result);
    }

    if (this.verbose && result.logs) {
      logger.log('\n' + chalk.bold(text.cli.stepLogs));
      result.logs.forEach((log) => {
        const symbol = log.success
          ? chalk.green(text.symbols.success)
          : chalk.red(text.symbols.error);
        logger.log(`${symbol} [${chalk.blue(log.step.toUpperCase())}] ${log.output}`);
      });
    }
  }

  onError(error: Error) {
    logger.error(text.cli.unexpectedError(error.message), true);
  }

  private initProgressBar() {
    this.bar = new ProgressBar(`${chalk.blue('[:bar]')} :phase :percent :elapseds`, {
      total: EXECUTION_PHASES.length,
      width: 20,
      complete: '=',
      incomplete: ' ',
    });
  }

  private handleLogEvent(event: { level: string; message: string }) {
    if (event.level === 'error') {
      logger.error(`  ${event.message}`);
    } else if (event.level === 'warn') {
      logger.warn(`  ${event.message}`);
    } else if (event.level === 'trace') {
      logger.trace(`  ${event.message}`);
    } else {
      logger.debug(`  ${event.message}`);
    }
  }

  private handleFailure(result: LoopResult) {
    logger.error(text.cli.operationFailed);
    logger.bold(text.cli.reason(result.reason));
    if (result.errorCode) {
      logger.error(text.cli.errorCode(result.errorCode));
    }
    if (result.auditPath) {
      logger.log(text.cli.auditPath(result.auditPath));
    }

    // Provide suggestions based on failure
    if (result.failurePhase === Phase.PREFLIGHT) {
      if (result.reasonCode === 'PREFLIGHT_DIRTY') {
        logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.dirty}`);
      } else if (result.reasonCode === 'PREFLIGHT_NOT_GIT') {
        logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.notGit}`);
      }
    } else if (result.failurePhase === Phase.VERIFY) {
      if (result.errorType === ErrorType.COMPILATION) {
        logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.compilation}`);
      } else if (result.errorType === ErrorType.LINT) {
        logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.lint}`);
      } else {
        logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.test}`);
      }
    } else if (result.failurePhase === Phase.ROLLBACK) {
      logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.rollbackFailed}`);
    }

    logger.log(text.cli.attempts(result.attempts));
  }
}
