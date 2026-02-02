import chalk from 'chalk';

import { FileAdapter } from './adapters/fs/file-adapter.js';
import { VerboseLevel } from './types.js';

export type LogLevel = 'none' | 'basic' | 'extended';

/**
 * Interface for log reporters
 */
export interface LogReporter {
  log(level: string, message: string, metadata?: any): void;
  clear?(): void;
}

/**
 * Standard Console Reporter
 */
export class ConsoleReporter implements LogReporter {
  constructor(private verboseLevel: LogLevel = 'none') {}

  setVerbose(level: LogLevel) {
    this.verboseLevel = level;
  }

  get isBasic() {
    return this.verboseLevel === 'basic' || this.verboseLevel === 'extended';
  }

  get isExtended() {
    return this.verboseLevel === 'extended';
  }

  log(level: string, message: string, metadata?: any): void {
    switch (level) {
      case 'info':
      case 'log':
      case 'bold':
        console.log(level === 'bold' ? chalk.bold(message) : message);
        break;
      case 'success':
        console.log(chalk.green(message));
        break;
      case 'warn':
      case 'degraded':
        console.warn(
          level === 'degraded' ? chalk.magenta(`[DEGRADED] ${message}`) : chalk.yellow(message),
        );
        break;
      case 'error':
        console.error(chalk.red(message));
        break;
      case 'debug':
        if (this.isBasic) console.log(chalk.gray(message));
        break;
      case 'trace':
        if (this.isExtended) console.log(chalk.gray(message));
        break;
      case 'cyan':
        console.log(chalk.cyan(message));
        break;
      case 'dim':
        console.log(chalk.dim(message));
        break;
      case 'step':
        if (this.isBasic) {
          const phase = metadata?.phase || 'STEP';
          console.log(chalk.blue(`\n[${phase.toUpperCase()}] `) + message);
        }
        break;
      case 'audit': {
        const timestamp = new Date().toISOString();
        console.log(chalk.bgBlue.white(`[AUDIT] ${timestamp} - ${message}`));
        break;
      }
    }
  }

  clear(): void {
    console.clear();
  }
}

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
  private reporter: LogReporter;

  constructor(options?: LoggerOptions) {
    this.setVerbose(options?.verbose);
    this.prefix = options?.prefix ?? '';
    this.logFile = options?.logFile;
    this.silent = options?.silent ?? false;
    this.reporter = new ConsoleReporter(this.verboseLevel);
  }

  setReporter(reporter: LogReporter) {
    this.reporter = reporter;
  }

  setVerbose(level: VerboseLevel | boolean | undefined) {
    if (level === true) {
      this.verboseLevel = 'basic';
    } else if (level === false || level === undefined) {
      this.verboseLevel = 'none';
    } else {
      this.verboseLevel = level;
    }
    if (this.reporter instanceof ConsoleReporter) {
      this.reporter.setVerbose(this.verboseLevel);
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
    const contentToFlush = [...this.logQueue];
    try {
      const content = contentToFlush.join('');
      await this.fileAdapter.appendFile(this.logFile, content);
      // Only remove from queue if write was successful
      this.logQueue.splice(0, contentToFlush.length);
    } catch {
      // Keep logs in queue for next retry
    } finally {
      this.isFlushing = false;
      if (this.logQueue.length > 0) {
        this.scheduleFlush();
      }
    }
  }

  /**
   * Manually flush all pending logs to disk
   */
  async flush(): Promise<void> {
    if (!this.logFile || this.logQueue.length === 0) return;

    // If already flushing, wait for it or trigger another one
    while (this.isFlushing) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await this.scheduleFlush();
  }

  info(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('info', formatted);
    if (!this.silent) this.reporter.log('info', formatted);
  }

  success(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('success', formatted);
    if (!this.silent) this.reporter.log('success', formatted);
  }

  warn(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('warn', formatted);
    if (!this.silent) this.reporter.log('warn', formatted);
  }

  error(message: string, exit = false): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('error', formatted);
    if (!this.silent) this.reporter.log('error', formatted);
    if (exit) process.exit(1);
  }

  debug(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('debug', formatted);
    if (!this.silent) this.reporter.log('debug', formatted);
  }

  trace(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('trace', formatted);
    if (!this.silent) this.reporter.log('trace', formatted);
  }

  step(phase: string, message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog(`step:${phase}`, formatted);
    if (!this.silent) this.reporter.log('step', formatted, { phase });
  }

  cyan(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('cyan', formatted);
    if (!this.silent) this.reporter.log('cyan', formatted);
  }

  bold(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('bold', formatted);
    if (!this.silent) this.reporter.log('bold', formatted);
  }

  dim(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('dim', formatted);
    if (!this.silent) this.reporter.log('dim', formatted);
  }

  log(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('log', formatted);
    if (!this.silent) this.reporter.log('log', formatted);
  }

  degrade(message: string): void {
    const formatted = this.formatMessage(message);
    this.writeToLog('degraded', formatted);
    if (!this.silent) this.reporter.log('degraded', formatted);
  }

  clear(): void {
    if (!this.silent && this.reporter.clear) this.reporter.clear();
  }

  audit(action: string, details: any): void {
    const rawMessage = `${action}: ${JSON.stringify(details)}`;
    const formatted = this.formatMessage(rawMessage);
    this.writeToLog('audit', formatted);
    if (!this.silent) this.reporter.log('audit', formatted);
  }
}

export const logger = new Logger();
