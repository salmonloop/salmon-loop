import { LIMITS } from './limits.js';
import { ErrorType } from './types.js';
import { text } from '../locales/index.js';

/**
 * Represents a single error entry in the monitor
 */
interface ErrorEntry {
  type: ErrorType;
  message: string;
  timestamp: Date;
}

/**
 * RingBuffer implementation to store a fixed number of recent errors
 */
class RingBuffer<T> {
  private buffer: T[];
  private head = 0;
  private size = 0;

  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    }
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.size; i++) {
      const index = (this.head - this.size + i + this.capacity) % this.capacity;
      result.push(this.buffer[index]);
    }
    return result;
  }

  get length(): number {
    return this.size;
  }
}

/**
 * Monitor class to track errors and generate reports
 */
export class Monitor {
  private static instance: Monitor;
  private errorHistory: RingBuffer<ErrorEntry>;

  private constructor() {
    this.errorHistory = new RingBuffer<ErrorEntry>(LIMITS.maxErrorHistory);
  }

  static getInstance(): Monitor {
    if (!Monitor.instance) {
      Monitor.instance = new Monitor();
    }
    return Monitor.instance;
  }

  /**
   * Record an error in the history
   */
  recordError(type: ErrorType, message: string): void {
    this.errorHistory.push({
      type,
      message,
      timestamp: new Date(),
    });
  }

  /**
   * Generate a formatted error report
   */
  getErrorReport(): string {
    const errors = this.errorHistory.toArray();
    if (errors.length === 0) {
      return text.monitor.noErrors;
    }

    let report = `\n=== ${text.monitor.reportTitle} ===\n`;
    report += `${text.monitor.totalErrors(errors.length)}\n\n`;
    report += `${text.monitor.recentErrors}\n`;

    for (const error of errors) {
      report += `${text.monitor.errorEntry(
        error.timestamp.toISOString(),
        error.type,
        error.message
      )}\n`;
    }

    report += '===========================================\n';
    return report;
  }

  /**
   * Check memory usage and log warning if it exceeds threshold
   */
  checkMemoryUsage(): void {
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
    const thresholdMB = 512;

    if (heapUsedMB > thresholdMB) {
      const msg = `Memory usage warning: Heap used ${heapUsedMB.toFixed(2)}MB exceeds threshold ${thresholdMB}MB.`;
      this.recordError(ErrorType.UNKNOWN, msg);
      console.warn(`[Monitor] ${msg}`);
      if (global.gc) {
        console.log('[Monitor] Suggesting garbage collection...');
        global.gc();
      }
    }
  }
}

export const monitor = Monitor.getInstance();
