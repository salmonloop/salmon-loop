import chalk from 'chalk';

import {
  mapErrorForDisplay,
  type LogLevel,
  type LogReporter,
} from '../../core/facades/cli-reporters.js';

export class StderrLogReporter implements LogReporter {
  constructor(private verboseLevel: LogLevel = 'none') {}

  setVerbose(level: LogLevel) {
    this.verboseLevel = level;
  }

  private get isBasic() {
    return this.verboseLevel === 'basic' || this.verboseLevel === 'extended';
  }

  private get isExtended() {
    return this.verboseLevel === 'extended';
  }

  log(level: string, message: string, metadata?: any): void {
    const safeMessage = mapErrorForDisplay({
      message,
      code: metadata?.code,
    }).message;

    const writeLine = (line: string) => {
      process.stderr.write(line + '\n');
    };

    switch (level) {
      case 'info':
      case 'log':
      case 'bold':
        writeLine(level === 'bold' ? chalk.bold(safeMessage) : safeMessage);
        break;
      case 'success':
        writeLine(chalk.green(safeMessage));
        break;
      case 'warn':
      case 'degraded':
        writeLine(
          level === 'degraded'
            ? chalk.magenta(`[DEGRADED] ${safeMessage}`)
            : chalk.yellow(safeMessage),
        );
        break;
      case 'error':
        writeLine(chalk.red(safeMessage));
        break;
      case 'debug':
        if (this.isBasic) writeLine(chalk.gray(safeMessage));
        break;
      case 'trace':
        if (this.isExtended) writeLine(chalk.gray(safeMessage));
        break;
      case 'cyan':
        writeLine(chalk.cyan(safeMessage));
        break;
      case 'dim':
        writeLine(chalk.dim(safeMessage));
        break;
      case 'step':
        if (this.isBasic) {
          const phase = metadata?.phase || 'STEP';
          writeLine(chalk.blue(`\n[${phase.toUpperCase()}] `) + safeMessage);
        }
        break;
      case 'audit': {
        const timestamp = new Date().toISOString();
        writeLine(chalk.bgBlue.white(`[AUDIT] ${timestamp} - ${safeMessage}`));
        break;
      }
    }
  }
}
