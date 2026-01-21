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
 */
export class Monitor {
  private static instance: Monitor;
  private errorHistory: RingBuffer<ErrorEntry>;
  private checkpointMetrics: CheckpointMetrics;
  private applyBackMetrics: ApplyBackMetrics;

  private constructor() {
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
    let report = '\n=== Checkpoint & ApplyBack Metrics ===\n';
    
    report += '\n[Checkpoint Creation]\n';
    report += `  Attempts: ${this.checkpointMetrics.createAttempts}\n`;
    report += `  Failures: ${this.checkpointMetrics.createFailures}\n`;
    report += `  Failure Rate: ${(this.getCheckpointCreateFailureRate() * 100).toFixed(2)}%\n`;
    
    report += '\n[Worktree Cleanup]\n';
    report += `  Attempts: ${this.checkpointMetrics.cleanupAttempts}\n`;
    report += `  Failures: ${this.checkpointMetrics.cleanupFailures}\n`;
    
    report += '\n[ApplyBack Operations]\n';
    report += `  Attempts: ${this.applyBackMetrics.attempts}\n`;
    report += `  Failures: ${this.applyBackMetrics.failures}\n`;
    report += `  Avg Duration: ${this.getApplyBackAvgDuration().toFixed(2)}ms\n`;
    
    if (this.applyBackMetrics.durations.length > 0) {
      const sorted = [...this.applyBackMetrics.durations].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)];
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      report += `  P50 Duration: ${p50.toFixed(2)}ms\n`;
      report += `  P95 Duration: ${p95.toFixed(2)}ms\n`;
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
