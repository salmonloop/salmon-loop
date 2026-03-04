import chalk from 'chalk';
import ProgressBar from 'progress';

import { mapErrorForDisplay } from '../../core/observability/error-mapping.js';
import { logger } from '../../core/observability/logger.js';
import { ALL_VISIBLE_STEPS, ErrorType, Phase } from '../../core/types/execution.js';
import { type LoopEvent, type LoopResult } from '../../core/types/loop.js';
import { text } from '../locales/index.js';

import { SalmonReporter } from './base.js';

export class StandardReporter implements SalmonReporter {
  private bar: ProgressBar | null = null;
  private lastAuthorizationSummary?: string;
  private lastStreamId?: string;

  constructor(private verbose: boolean = false) {}

  onStart(_instruction: string) {
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
      case 'authorization.summary': {
        const summary = this.formatAuthorizationSummary(event.summary);
        if (summary !== this.lastAuthorizationSummary) {
          logger.info(text.cli.authorizationSummaryRealtime(summary));
          this.lastAuthorizationSummary = summary;
        }
        break;
      }
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
        this.bar?.terminate();
        this.initProgressBar();
        break;
      case 'llm.stream.delta': {
        const delta = event.content;
        const shouldPrint = delta.length > 0 && (delta.trim().length > 0 || delta.includes('\n'));
        if (shouldPrint) {
          if (event.streamId !== this.lastStreamId) {
            this.lastStreamId = event.streamId;
            const header = this.renderPhaseLabel(event.step);

            if (this.bar) {
              this.bar.interrupt(header);
            } else {
              logger.log(header);
            }
          }
          if (this.bar) {
            this.bar.interrupt(delta);
          } else {
            process.stdout.write(delta);
          }
        }
        break;
      }
      case 'llm.output': {
        const header = this.renderPhaseLabel(event.step);
        if (this.bar) {
          this.bar.interrupt(header);
          this.bar.interrupt(event.content);
        } else {
          logger.log(header);
          logger.log(event.content);
        }
        break;
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

    if (result.authorizationSummary) {
      const summary = this.formatAuthorizationSummary(result.authorizationSummary);
      logger.info(text.cli.authorizationSummary(summary));
    }
    if (result.budgetSummary) {
      const s = result.budgetSummary;
      logger.info(text.cli.budgetSummaryTitle);
      logger.info(
        text.cli.budgetSummaryLine(
          s.attemptCount,
          s.adjustmentCount,
          s.alertCount,
          s.criticalDropCount,
          Math.round(s.avgUtilization * 100),
          Math.round(s.truncationRate * 100),
          Math.round(s.successRate * 100),
        ),
      );
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
    // 🛡️ DCAP Defense: Check if stderr supports TTY operations to prevent clearLine crashes and unexpected termination
    const stream = process.stderr as any;
    if (typeof stream.clearLine !== 'function' || typeof stream.cursorTo !== 'function') {
      this.bar = {
        render: () => {},
        tick: () => {},
        terminate: () => {},
        interrupt: (msg: string) => logger.info(msg),
      } as any;
      return;
    }

    this.bar = new ProgressBar(`${chalk.blue('[:bar]')} :phase :percent :elapseds`, {
      total: ALL_VISIBLE_STEPS.length,
      width: 20,
      complete: '=',
      incomplete: ' ',
    });
  }

  private renderPhaseLabel(step: string): string {
    const phaseKey = step.toLowerCase();
    const phaseName = (text.progress as any)[phaseKey] || step;
    return chalk.blue(`\n[${step.toUpperCase()}] `) + phaseName;
  }

  private handleLogEvent(event: { level: string; message: string; code?: string }) {
    const displayMessage = mapErrorForDisplay({
      message: event.message,
      code: event.code,
    }).message;

    if (event.level === 'error') {
      logger.error(displayMessage);
    } else if (event.level === 'warn') {
      logger.warn(displayMessage);
    } else if (event.level === 'trace') {
      logger.trace(displayMessage);
    } else if (event.level === 'info') {
      logger.info(displayMessage);
    } else {
      logger.debug(displayMessage);
    }
  }

  private formatAuthorizationSummary(summary: {
    auto: number;
    allowlist: number;
    user: number;
    cache: number;
    cli: number;
    hook: number;
  }) {
    const { auto, allowlist, user, cache, cli, hook } = summary;
    return `auto=${auto} allowlist=${allowlist} user=${user} cache=${cache} cli=${cli} hook=${hook}`;
  }

  private handleFailure(result: LoopResult) {
    const envelope = result.errorEnvelope;
    const failureReason = envelope?.safeHint || result.safeHint || result.reason;
    const remediationSteps =
      envelope?.remediationSteps && envelope.remediationSteps.length > 0
        ? envelope.remediationSteps
        : result.remediationSteps;
    logger.error(text.cli.operationFailed);
    logger.bold(text.cli.reason(failureReason));
    if (result.diagnosticCode) {
      logger.error(`  Diagnostic code: ${result.diagnosticCode}`);
    }
    const errorCode = envelope?.code || result.errorCode;
    if (errorCode) {
      logger.error(text.cli.errorCode(errorCode));
    }
    if (result.auditPath) {
      logger.log(text.cli.auditPath(result.auditPath));
    }
    if (result.verifyArtifact?.handle) {
      logger.log(text.cli.verifyOutputArtifact(result.verifyArtifact.handle));
    }
    if (Array.isArray(remediationSteps) && remediationSteps.length > 0) {
      for (const step of remediationSteps) {
        logger.cyan(`${text.symbols.suggestion} ${step}`);
      }
    }

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
