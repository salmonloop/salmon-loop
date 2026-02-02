import chalk from 'chalk';

import { FileAdapter } from './adapters/fs/file-adapter.js';
import { VerboseLevel } from './types.js';

export type LogLevel = 'none' | 'basic' | 'extended';

export interface LoggerOptions {
  verbose?: VerboseLevel | boolean;
  prefix?: string;
  logFile?: string;
  silent?: boolean;
}

export class Logger {
  private verboseLevel: LogLevel = 'none';
  private prefix: string;
  private logFile?: string;
  private silent: boolean = false;
  private fileAdapter = new FileAdapter();
  private logQueue: string[] = [];
  private isFlushing = false;

  constructor(options?: LoggerOptions) {
    this.setVerbose(options?.verbose);
    this.prefix = options?.prefix ?? '';
    this.logFile = options?.logFile;
    this.silent = options?.silent ?? false;
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

  setSilent(silent: boolean) {
    this.silent = silent;
  }

  setLogFile(path: string) {
    this.logFile = path;
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

  private writeToLog(level: string, message: string) {
    if (this.logFile) {
      const timestamp = new Date().toISOString();
      // eslint-disable-next-line no-control-regex
      const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, ''); // Remove ANSI colors
      this.logQueue.push(`[${timestamp}] [${level.toUpperCase()}] ${cleanMessage}\n`);
      this.scheduleFlush();
    }
  }

  private async scheduleFlush() {
    if (this.isFlushing || this.logQueue.length === 0 || !this.logFile) {
      return;
    }

    this.isFlushing = true;
    try {
      const content = this.logQueue.join('');
      this.logQueue = [];
      // Success: use project-wrapped FileAdapter to append logs
      await this.fileAdapter.appendFile(this.logFile, content);
    } catch {
      // Fail silently to prevent logging issues from affecting core logic
    } finally {
      this.isFlushing = false;
      // Handle new logs accumulated during the flush process
      if (this.logQueue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  info(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('info', formatted);
    if (!this.silent) {
      console.log(formatted);
    }
  }

  success(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('success', formatted);
    if (!this.silent) {
      console.log(chalk.green(formatted));
    }
  }

  warn(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('warn', formatted);
    if (!this.silent) {
      console.warn(chalk.yellow(formatted));
    }
  }

  error(message: string, exit = false): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('error', formatted);
    if (!this.silent) {
      console.error(chalk.red(formatted));
    }
    if (exit) {
      process.exit(1);
    }
  }

  debug(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('debug', formatted);
    if (this.isBasic && !this.silent) {
      console.log(chalk.gray(formatted));
    }
  }

  trace(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('trace', formatted);
    if (this.isExtended && !this.silent) {
      console.log(chalk.gray(formatted));
    }
  }

  step(phase: string, message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog(`step:${phase}`, formatted);
    if (this.isBasic && !this.silent) {
      console.log(chalk.blue(`\n[${phase.toUpperCase()}] `) + formatted);
    }
  }

  cyan(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('cyan', formatted);
    if (!this.silent) {
      console.log(chalk.cyan(formatted));
    }
  }

  bold(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('bold', formatted);
    if (!this.silent) {
      console.log(chalk.bold(formatted));
    }
  }

  dim(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('dim', formatted);
    if (!this.silent) {
      console.log(chalk.dim(formatted));
    }
  }

  log(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('log', formatted);
    if (!this.silent) {
      console.log(formatted);
    }
  }

  degrade(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('degraded', formatted);
    if (!this.silent) {
      console.warn(chalk.magenta(`[DEGRADED] ${formatted}`));
    }
  }

  clear(): void {
    if (!this.silent) {
      console.clear();
    }
  }

  audit(action: string, details: any): void {
    const timestamp = new Date().toISOString();
    const rawMessage = `${action}: ${JSON.stringify(details)}`;
    const formatted = this.formatMessage(rawMessage);
    this.writeToLog('audit', formatted);
    if (!this.silent) {
      const displayMessage = `[AUDIT] ${timestamp} - ${formatted}`;
      console.log(chalk.bgBlue.white(displayMessage));
    }
  }
}

export const logger = new Logger();
