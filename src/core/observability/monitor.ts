import { text } from '../../locales/index.js';
import { LIMITS } from '../config/limits.js';
import { ErrorType } from '../types/index.js';

import { getLogger } from './logger.js';

/**
 * Represents a single error entry in the monitor
 */
interface ErrorEntry {
  type: ErrorType;
  message: string;
  timestamp: Date;
}

/**
 * Checkpoint metrics for monitoring
 */
interface CheckpointMetrics {
  createAttempts: number;
  createFailures: number;
  cleanupAttempts: number;
  cleanupFailures: number;
}

/**
 * ApplyBack metrics for monitoring
 */
interface ApplyBackMetrics {
  attempts: number;
  failures: number;
  totalDuration: number;
  durations: number[];
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
 *
 * Can be used as:
 * - Singleton: `import { monitor } from './monitor.js'`
 * - Instance: `const m = new Monitor()` (useful for testing)
 */
export class Monitor {
  private static instance: Monitor;
  private errorHistory: RingBuffer<ErrorEntry>;
  private checkpointMetrics: CheckpointMetrics;
  private applyBackMetrics: ApplyBackMetrics;

  constructor() {
    this.errorHistory = new RingBuffer<ErrorEntry>(LIMITS.maxErrorHistory);
    this.checkpointMetrics = {
      createAttempts: 0,
      createFailures: 0,
      cleanupAttempts: 0,
      cleanupFailures: 0,
    };
    this.applyBackMetrics = {
      attempts: 0,
      failures: 0,
      totalDuration: 0,
      durations: [],
    };
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
        error.message,
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
      const msg = text.monitor.memoryWarning(heapUsedMB.toFixed(2), thresholdMB.toString());
      this.recordError(ErrorType.UNKNOWN, msg);
      getLogger().warn(`[Monitor] ${msg}`);
      if (global.gc) {
        getLogger().debug(`[Monitor] ${text.monitor.suggestingGc}`);
        global.gc();
      }
    }
  }

  /**
   * Record checkpoint creation attempt
   */
  recordCheckpointCreate(success: boolean): void {
    this.checkpointMetrics.createAttempts++;
    if (!success) {
      this.checkpointMetrics.createFailures++;
    }
  }

  /**
   * Record checkpoint cleanup attempt
   */
  recordCheckpointCleanup(success: boolean): void {
    this.checkpointMetrics.cleanupAttempts++;
    if (!success) {
      this.checkpointMetrics.cleanupFailures++;
    }
  }

  /**
   * Record applyBack operation
   */
  recordApplyBack(success: boolean, duration: number): void {
    this.applyBackMetrics.attempts++;
    if (!success) {
      this.applyBackMetrics.failures++;
    }
    this.applyBackMetrics.totalDuration += duration;
    this.applyBackMetrics.durations.push(duration);

    // Keep only last 100 durations to avoid memory bloat
    if (this.applyBackMetrics.durations.length > 100) {
      this.applyBackMetrics.durations.shift();
    }
  }

  /**
   * Get checkpoint creation failure rate (0-1)
   */
  getCheckpointCreateFailureRate(): number {
    if (this.checkpointMetrics.createAttempts === 0) return 0;
    return this.checkpointMetrics.createFailures / this.checkpointMetrics.createAttempts;
  }

  /**
   * Get worktree cleanup failure count
   */
  getWorktreeCleanupFailureCount(): number {
    return this.checkpointMetrics.cleanupFailures;
  }

  /**
   * Get average applyBack duration in milliseconds
   */
  getApplyBackAvgDuration(): number {
    if (this.applyBackMetrics.attempts === 0) return 0;
    return this.applyBackMetrics.totalDuration / this.applyBackMetrics.attempts;
  }

  /**
   * Get checkpoint metrics summary
   */
  getCheckpointMetrics(): CheckpointMetrics {
    return { ...this.checkpointMetrics };
  }

  /**
   * Get applyBack metrics summary
   */
  getApplyBackMetrics(): Readonly<ApplyBackMetrics> {
    return {
      attempts: this.applyBackMetrics.attempts,
      failures: this.applyBackMetrics.failures,
      totalDuration: this.applyBackMetrics.totalDuration,
      durations: [...this.applyBackMetrics.durations],
    };
  }

  /**
   * Generate metrics report
   */
  getMetricsReport(): string {
    let report = `\n${text.monitor.metricsTitle}\n`;

    report += `\n${text.monitor.checkpointCreation}\n`;
    report += `${text.monitor.attempts(this.checkpointMetrics.createAttempts)}\n`;
    report += `${text.monitor.failures(this.checkpointMetrics.createFailures)}\n`;
    report += `${text.monitor.failureRate((this.getCheckpointCreateFailureRate() * 100).toFixed(2))}\n`;

    report += `\n${text.monitor.worktreeCleanup}\n`;
    report += `${text.monitor.attempts(this.checkpointMetrics.cleanupAttempts)}\n`;
    report += `${text.monitor.failures(this.checkpointMetrics.cleanupFailures)}\n`;

    report += `\n${text.monitor.applyBackOps}\n`;
    report += `${text.monitor.attempts(this.applyBackMetrics.attempts)}\n`;
    report += `${text.monitor.failures(this.applyBackMetrics.failures)}\n`;
    report += `${text.monitor.avgDuration(this.getApplyBackAvgDuration().toFixed(2))}\n`;

    if (this.applyBackMetrics.durations.length > 0) {
      const sorted = [...this.applyBackMetrics.durations].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      report += `${text.monitor.p50Duration(p50.toFixed(2))}\n`;
      report += `${text.monitor.p95Duration(p95.toFixed(2))}\n`;
    }

    report += '======================================\n';
    return report;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  resetMetrics(): void {
    this.checkpointMetrics = {
      createAttempts: 0,
      createFailures: 0,
      cleanupAttempts: 0,
      cleanupFailures: 0,
    };
    this.applyBackMetrics = {
      attempts: 0,
      failures: 0,
      totalDuration: 0,
      durations: [],
    };
  }
}

export const monitor = Monitor.getInstance();
