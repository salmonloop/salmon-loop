import chalk from 'chalk';
import ProgressBar from 'progress';

import {
  ALL_VISIBLE_STEPS,
  ErrorType,
  getLogger,
  mapErrorForDisplay,
  Phase,
  type LoopEvent,
  type LoopResult,
} from '../../core/facades/cli-reporters.js';
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
        getLogger().step(event.phase, phaseName);
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
          getLogger().info(text.cli.authorizationSummaryRealtime(summary));
          this.lastAuthorizationSummary = summary;
        }
        break;
      }
      case 'verify.result':
        if (!event.ok) {
          getLogger().error('\n' + text.cli.operationFailed);
          getLogger().debug(event.output);
        }
        break;
      case 'diff.meta':
        getLogger().success(text.cli.diffMeta(event.fileCount, event.lineCount));
        break;
      case 'retry':
        getLogger().warn(
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

        if (!shouldPrint) {
          break;
        }

        if (event.streamId !== this.lastStreamId) {
          this.lastStreamId = event.streamId;
          const header = this.renderPhaseLabel(event.step);

          if (this.bar) {
            this.bar.interrupt(header);
          } else {
            getLogger().log(header);
          }
        }

        if (this.bar) {
          this.bar.interrupt(delta);
        } else {
          process.stdout.write(delta);
        }
        break;
      }
      case 'llm.output': {
        const header = this.renderPhaseLabel(event.step);
        if (this.bar) {
          this.bar.interrupt(header);
          this.bar.interrupt(event.content);
        } else {
          getLogger().log(header);
          getLogger().log(event.content);
        }
        break;
      }
    }
  }

  onFinish(result: LoopResult) {
    this.bar?.terminate();
    if (result.success) {
      getLogger().success(text.cli.operationSuccess);
      getLogger().log(text.cli.attempts(result.attempts));
    } else {
      this.handleFailure(result);
    }

    if (result.authorizationSummary) {
      const summary = this.formatAuthorizationSummary(result.authorizationSummary);
      getLogger().info(text.cli.authorizationSummary(summary));
    }
    if (result.budgetSummary) {
      const s = result.budgetSummary;
      getLogger().info(text.cli.budgetSummaryTitle);
      getLogger().info(
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
      getLogger().log('\n' + chalk.bold(text.cli.stepLogs));
      result.logs.forEach((log) => {
        const symbol = log.success
          ? chalk.green(text.symbols.success)
          : chalk.red(text.symbols.error);
        getLogger().log(`${symbol} [${chalk.blue(log.step.toUpperCase())}] ${log.output}`);
      });
    }
  }

  onError(error: Error) {
    getLogger().error(text.cli.unexpectedError(error.message), true);
  }

  private initProgressBar() {
    // 🛡️ DCAP Defense: Check if stderr supports TTY operations to prevent clearLine crashes and unexpected termination
    const stream = process.stderr as any;
    if (typeof stream.clearLine !== 'function' || typeof stream.cursorTo !== 'function') {
      this.bar = {
        render: () => {},
        tick: () => {},
        terminate: () => {},
        interrupt: (msg: string) => getLogger().info(msg),
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
      getLogger().error(displayMessage);
    } else if (event.level === 'warn') {
      getLogger().warn(displayMessage);
    } else if (event.level === 'trace') {
      getLogger().trace(displayMessage);
    } else if (event.level === 'info') {
      getLogger().info(displayMessage);
    } else {
      getLogger().debug(displayMessage);
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
    getLogger().error(text.cli.operationFailed);
    getLogger().bold(text.cli.reason(failureReason));
    if (result.diagnosticCode) {
      getLogger().error(`  Diagnostic code: ${result.diagnosticCode}`);
    }
    const errorCode = envelope?.code || result.errorCode;
    if (errorCode) {
      getLogger().error(text.cli.errorCode(errorCode));
    }
    if (result.auditPath) {
      getLogger().log(text.cli.auditPath(result.auditPath));
    }
    if (result.verifyArtifact?.handle) {
      getLogger().log(text.cli.verifyOutputArtifact(result.verifyArtifact.handle));
    }
    if (Array.isArray(remediationSteps) && remediationSteps.length > 0) {
      for (const step of remediationSteps) {
        getLogger().cyan(`${text.symbols.suggestion} ${step}`);
      }
    }

    if (result.failurePhase === Phase.PREFLIGHT) {
      if (result.reasonCode === 'PREFLIGHT_DIRTY') {
        getLogger().cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.dirty}`);
      } else if (result.reasonCode === 'PREFLIGHT_NOT_GIT') {
        getLogger().cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.notGit}`);
      }
    } else if (result.failurePhase === Phase.VERIFY) {
      if (result.errorType === ErrorType.COMPILATION) {
        getLogger().cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.compilation}`);
      } else if (result.errorType === ErrorType.LINT) {
        getLogger().cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.lint}`);
      } else {
        getLogger().cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.test}`);
      }
    } else if (result.failurePhase === Phase.ROLLBACK) {
      getLogger().cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.rollbackFailed}`);
    }

    getLogger().log(text.cli.attempts(result.attempts));
  }
}
