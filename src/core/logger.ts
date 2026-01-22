import chalk from 'chalk';

import { VerboseLevel } from './types.js';

export type LogLevel = 'none' | 'basic' | 'extended';

export interface LoggerOptions {
  verbose?: VerboseLevel | boolean;
  prefix?: string;
}

export class Logger {
  private verboseLevel: LogLevel = 'none';
  private prefix: string;

  constructor(options?: LoggerOptions) {
    this.setVerbose(options?.verbose);
    this.prefix = options?.prefix ?? '';
  }

  setVerbose(level: VerboseLevel | boolean | undefined) {
    if (level === true) {
      this.verboseLevel = 'basic';
    } else if (level === false || level === undefined) {
      this.verboseLevel = 'none';
    } else {
      this.verboseLevel = level;
    }
  }

  setPrefix(prefix: string) {
    this.prefix = prefix;
  }

  get isBasic() {
    return this.verboseLevel === 'basic' || this.verboseLevel === 'extended';
  }

  get isExtended() {
    return this.verboseLevel === 'extended';
  }

  private formatMessage(message: string): string {
    return this.prefix ? `${this.prefix} ${message}` : message;
  }

  info(message: string): void {
    console.log(this.formatMessage(message));
  }

  success(message: string): void {
    console.log(chalk.green(this.formatMessage(message)));
  }

  warn(message: string): void {
    console.warn(chalk.yellow(this.formatMessage(message)));
  }

  error(message: string, exit = false): void {
    console.error(chalk.red(this.formatMessage(message)));
    if (exit) {
      process.exit(1);
    }
  }

  debug(message: string): void {
    if (this.isBasic) {
      console.log(chalk.gray(this.formatMessage(message)));
    }
  }

  trace(message: string): void {
    if (this.isExtended) {
      console.log(chalk.gray(this.formatMessage(message)));
    }
  }

  step(phase: string, message: string): void {
    if (this.isBasic) {
      console.log(chalk.blue(`\n[${phase.toUpperCase()}] `) + this.formatMessage(message));
    }
  }

  cyan(message: string): void {
    console.log(chalk.cyan(this.formatMessage(message)));
  }

  bold(message: string): void {
    console.log(chalk.bold(this.formatMessage(message)));
  }

  dim(message: string): void {
    console.log(chalk.dim(this.formatMessage(message)));
  }

  log(message: string): void {
    console.log(this.formatMessage(message));
  }

  /**
   * Log a degradation warning when falling back to older APIs or behaviors
   */
  degrade(message: string): void {
    const formattedMessage = chalk.magenta(`[DEGRADED] ${this.formatMessage(message)}`);
    console.warn(formattedMessage);
  }

  /**
   * Log a security audit message
   */
  audit(action: string, details: any): void {
    const timestamp = new Date().toISOString();
    const message = `[AUDIT] ${timestamp} - ${action}: ${JSON.stringify(details)}`;
    const formattedMessage = chalk.bgBlue.white(this.formatMessage(message));
    console.log(formattedMessage);
  }
}

export const logger = new Logger();
