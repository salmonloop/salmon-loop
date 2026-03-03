import chalk from 'chalk';

import { FileAdapter } from '../adapters/fs/index.js';
import { VerboseLevel } from '../types/index.js';
import { sanitizeObject, sanitizeErrorMessage } from '../utils/sanitizer.js';

import type { AuditTrailMeta } from './audit-trail.js';
import { recordAuditEvent } from './audit-trail.js';
import { mapErrorForDisplay } from './error-mapping.js';

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
    const safeMessage = mapErrorForDisplay({
      message,
      code: metadata?.code,
    }).message;
    switch (level) {
      case 'info':
      case 'log':
      case 'bold':
        console.log(level === 'bold' ? chalk.bold(safeMessage) : safeMessage);
        break;
      case 'success':
        console.log(chalk.green(safeMessage));
        break;
      case 'warn':
      case 'degraded':
        console.warn(
          level === 'degraded'
            ? chalk.magenta(`[DEGRADED] ${safeMessage}`)
            : chalk.yellow(safeMessage),
        );
        break;
      case 'error':
        console.error(chalk.red(safeMessage));
        break;
      case 'debug':
        if (this.isBasic) console.log(chalk.gray(safeMessage));
        break;
      case 'trace':
        if (this.isExtended) console.log(chalk.gray(safeMessage));
        break;
      case 'cyan':
        console.log(chalk.cyan(safeMessage));
        break;
      case 'dim':
        console.log(chalk.dim(safeMessage));
        break;
      case 'step':
        if (this.isBasic) {
          const phase = metadata?.phase || 'STEP';
          console.log(chalk.blue(`\n[${phase.toUpperCase()}] `) + safeMessage);
        }
        break;
      case 'audit': {
        const timestamp = new Date().toISOString();
        console.log(chalk.bgBlue.white(`[AUDIT] ${timestamp} - ${safeMessage}`));
        break;
      }
    }
  }

  clear(): void {
    console.clear();
  }
}

/**
 * Stderr-only reporter for protocols that reserve stdout (e.g., ACP stdio).
 */
export class StderrReporter implements LogReporter {
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
    const safeMessage = mapErrorForDisplay({
      message,
      code: metadata?.code,
    }).message;
    switch (level) {
      case 'info':
      case 'log':
      case 'bold':
        console.error(level === 'bold' ? chalk.bold(safeMessage) : safeMessage);
        break;
      case 'success':
        console.error(chalk.green(safeMessage));
        break;
      case 'warn':
      case 'degraded':
        console.error(
          level === 'degraded'
            ? chalk.magenta(`[DEGRADED] ${safeMessage}`)
            : chalk.yellow(safeMessage),
        );
        break;
      case 'error':
        console.error(chalk.red(safeMessage));
        break;
      case 'debug':
        if (this.isBasic) console.error(chalk.gray(safeMessage));
        break;
      case 'trace':
        if (this.isExtended) console.error(chalk.gray(safeMessage));
        break;
      case 'cyan':
        console.error(chalk.cyan(safeMessage));
        break;
      case 'dim':
        console.error(chalk.dim(safeMessage));
        break;
      case 'step':
        if (this.isBasic) {
          const phase = metadata?.phase || 'STEP';
          console.error(chalk.blue(`\n[${phase.toUpperCase()}] `) + safeMessage);
        }
        break;
      case 'audit': {
        const timestamp = new Date().toISOString();
        console.error(chalk.bgBlue.white(`[AUDIT] ${timestamp} - ${safeMessage}`));
        break;
      }
    }
  }

  clear(): void {
    // No-op: stderr cannot be cleared reliably without side effects.
  }
}

/**
 * Plain text reporter without colors for environments where ANSI colors should be disabled.
 */
export class PlainReporter implements LogReporter {
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
      console.error(line);
    };

    switch (level) {
      case 'info':
      case 'log':
      case 'bold':
        writeLine(safeMessage);
        break;
      case 'success':
        writeLine(safeMessage);
        break;
      case 'warn':
      case 'degraded':
        writeLine(level === 'degraded' ? `[DEGRADED] ${safeMessage}` : safeMessage);
        break;
      case 'error':
        writeLine(safeMessage);
        break;
      case 'debug':
        if (this.isBasic) writeLine(safeMessage);
        break;
      case 'trace':
        if (this.isExtended) writeLine(safeMessage);
        break;
      case 'cyan':
        writeLine(safeMessage);
        break;
      case 'dim':
        writeLine(safeMessage);
        break;
      case 'step':
        if (this.isBasic) {
          const phase = metadata?.phase || 'STEP';
          writeLine(`\n[${phase.toUpperCase()}] ${safeMessage}`);
        }
        break;
      case 'audit': {
        const timestamp = new Date().toISOString();
        writeLine(`[AUDIT] ${timestamp} - ${safeMessage}`);
        break;
      }
    }
  }

  clear(): void {
    // No-op: stderr cannot be cleared reliably without side effects.
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

  getReporter(): LogReporter {
    return this.reporter;
  }

  setVerbose(level: VerboseLevel | boolean | undefined) {
    if (level === true) {
      this.verboseLevel = 'basic';
    } else if (level === false || level === undefined) {
      this.verboseLevel = 'none';
    } else {
      this.verboseLevel = level;
    }
    const maybeVerbose = this.reporter as any;
    if (typeof maybeVerbose?.setVerbose === 'function') {
      maybeVerbose.setVerbose(this.verboseLevel);
    }
  }

  setPrefix(prefix: string) {
    this.prefix = prefix;
  }

  setSilent(silent: boolean) {
    this.silent = silent;
  }

  getSilent(): boolean {
    return this.silent;
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

  error(message: string, errorOrExit?: unknown | boolean, maybeExit?: boolean): void {
    let error: unknown | undefined;
    let exit = false;

    // Handle polymorphism for backward compatibility:
    // Case 1: error(msg, exit)
    if (typeof errorOrExit === 'boolean' && maybeExit === undefined) {
      exit = errorOrExit;
    }
    // Case 2: error(msg, err, exit)
    else {
      error = errorOrExit;
      exit = maybeExit ?? false;
    }

    const sanitizedMessage = this.sanitizeLogMessage(
      this.formatMessage(sanitizeErrorMessage(message)),
    );
    const sanitizedError = error ? sanitizeObject(error) : undefined;

    this.writeToLog(
      'error',
      sanitizedMessage + (sanitizedError ? ` | ${JSON.stringify(sanitizedError)}` : ''),
    );

    if (!this.silent) {
      this.reporter.log('error', sanitizedMessage);
      // Removed: console.error(sanitizedError) to prevent JSON leakage to UI
    }

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

  audit(action: string, details: any, meta?: string | AuditTrailMeta): void {
    const sanitizedDetails = sanitizeObject(details);
    const rawMessage = `${action}: ${JSON.stringify(sanitizedDetails)}`;
    const formatted = this.formatMessage(this.sanitizeLogMessage(rawMessage));
    const auditMeta = typeof meta === 'string' ? { source: meta } : meta;
    recordAuditEvent(action, sanitizedDetails, auditMeta);
    this.writeToLog('audit', formatted);
    if (!this.silent) this.reporter.log('audit', formatted);
  }

  private sanitizeLogMessage(message: string): string {
    let result = '';
    for (let i = 0; i < message.length; i += 1) {
      const code = message.charCodeAt(i);
      if (code < 32 || code === 127) {
        result += ' ';
      } else {
        result += message[i];
      }
    }
    return result;
  }
}

export const logger = new Logger();
