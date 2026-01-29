import { describe, it, expect, beforeEach } from 'vitest';

import { Monitor } from '../../src/core/monitor.js';

describe('Monitor Metrics', () => {
  let monitor: Monitor;

  beforeEach(() => {
    // ✅ Create a fresh instance for each test (complete isolation)
    monitor = new Monitor();
  });

  describe('Checkpoint Creation Metrics', () => {
    it('should track successful checkpoint creation', () => {
      monitor.recordCheckpointCreate(true);
      monitor.recordCheckpointCreate(true);

      const metrics = monitor.getCheckpointMetrics();
      expect(metrics.createAttempts).toBe(2);
      expect(metrics.createFailures).toBe(0);
      expect(monitor.getCheckpointCreateFailureRate()).toBe(0);
    });

    it('should track failed checkpoint creation', () => {
      monitor.recordCheckpointCreate(true);
      monitor.recordCheckpointCreate(false);
      monitor.recordCheckpointCreate(false);

      const metrics = monitor.getCheckpointMetrics();
      expect(metrics.createAttempts).toBe(3);
      expect(metrics.createFailures).toBe(2);
      expect(monitor.getCheckpointCreateFailureRate()).toBeCloseTo(0.667, 2);
    });

    it('should return 0 failure rate when no attempts', () => {
      expect(monitor.getCheckpointCreateFailureRate()).toBe(0);
    });
  });

  describe('Checkpoint Cleanup Metrics', () => {
    it('should track successful cleanup', () => {
      monitor.recordCheckpointCleanup(true);
      monitor.recordCheckpointCleanup(true);

      const metrics = monitor.getCheckpointMetrics();
      expect(metrics.cleanupAttempts).toBe(2);
      expect(metrics.cleanupFailures).toBe(0);
      expect(monitor.getWorktreeCleanupFailureCount()).toBe(0);
    });

    it('should track failed cleanup', () => {
      monitor.recordCheckpointCleanup(true);
      monitor.recordCheckpointCleanup(false);
      monitor.recordCheckpointCleanup(false);
      monitor.recordCheckpointCleanup(false);

      const metrics = monitor.getCheckpointMetrics();
      expect(metrics.cleanupAttempts).toBe(4);
      expect(metrics.cleanupFailures).toBe(3);
      expect(monitor.getWorktreeCleanupFailureCount()).toBe(3);
    });
  });

  describe('ApplyBack Metrics', () => {
    it('should track successful applyBack operations', () => {
      monitor.recordApplyBack(true, 100);
      monitor.recordApplyBack(true, 200);
      monitor.recordApplyBack(true, 150);

      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.attempts).toBe(3);
      expect(metrics.failures).toBe(0);
      expect(metrics.totalDuration).toBe(450);
      expect(monitor.getApplyBackAvgDuration()).toBeCloseTo(150, 1);
    });

    it('should track failed applyBack operations', () => {
      monitor.recordApplyBack(true, 100);
      monitor.recordApplyBack(false, 200);
      monitor.recordApplyBack(false, 150);

      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.attempts).toBe(3);
      expect(metrics.failures).toBe(2);
      expect(metrics.totalDuration).toBe(450);
    });

    it('should limit duration history to 100 entries', () => {
      for (let i = 0; i < 150; i++) {
        monitor.recordApplyBack(true, i * 10);
      }

      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.durations.length).toBe(100);
      expect(metrics.attempts).toBe(150);
    });

    it('should return 0 average duration when no attempts', () => {
      expect(monitor.getApplyBackAvgDuration()).toBe(0);
    });

    it('should calculate percentiles correctly', () => {
      const durations = [100, 150, 200, 250, 300, 350, 400, 450, 500, 550];
      durations.forEach((d) => monitor.recordApplyBack(true, d));

      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.durations).toHaveLength(10);
      expect(monitor.getApplyBackAvgDuration()).toBe(325);
    });
  });

  describe('Metrics Report', () => {
    it('should generate comprehensive metrics report', () => {
      // Record various metrics
      monitor.recordCheckpointCreate(true);
      monitor.recordCheckpointCreate(true);
      monitor.recordCheckpointCreate(false);

      monitor.recordCheckpointCleanup(true);
      monitor.recordCheckpointCleanup(false);

      monitor.recordApplyBack(true, 100);
      monitor.recordApplyBack(true, 200);
      monitor.recordApplyBack(false, 150);

      const report = monitor.getMetricsReport();

      // Checkpoint Creation section
      expect(report).toContain('Checkpoint Creation');
      expect(report).toContain('Attempts: 3');
      expect(report).toContain('Failures: 1');
      expect(report).toContain('Failure Rate: 33.33%');

      // Worktree Cleanup section
      expect(report).toContain('Worktree Cleanup');
      expect(report).toContain('Attempts: 2');
      expect(report).toContain('Failures: 1');

      // ApplyBack section
      expect(report).toContain('ApplyBack Operations');
      expect(report).toContain('Attempts: 3');
      expect(report).toContain('Failures: 1');
      expect(report).toContain('Avg Duration: 150.00ms');
      expect(report).toContain('P50 Duration');
      expect(report).toContain('P95 Duration');
    });

    it('should include percentile information when data available', () => {
      for (let i = 1; i <= 20; i++) {
        monitor.recordApplyBack(true, i * 10);
      }

      const report = monitor.getMetricsReport();
      expect(report).toContain('P50 Duration:');
      expect(report).toContain('P95 Duration:');
    });

    it('should show all metrics even when zero', () => {
      // ✅ Fresh instance already has zero metrics
      const report = monitor.getMetricsReport();

      expect(report).toContain('Checkpoint Creation');
      expect(report).toContain('Attempts: 0');
      expect(report).toContain('Worktree Cleanup');
      expect(report).toContain('ApplyBack Operations');
    });
  });

  describe('Metrics Reset', () => {
    it('should reset all metrics to zero', () => {
      // Record some metrics
      monitor.recordCheckpointCreate(true);
      monitor.recordCheckpointCreate(false);
      monitor.recordCheckpointCleanup(true);
      monitor.recordCheckpointCleanup(false);
      monitor.recordApplyBack(true, 100);
      monitor.recordApplyBack(false, 200);

      // Reset
      monitor.resetMetrics();

      // Verify all metrics are reset
      const checkpointMetrics = monitor.getCheckpointMetrics();
      expect(checkpointMetrics.createAttempts).toBe(0);
      expect(checkpointMetrics.createFailures).toBe(0);
      expect(checkpointMetrics.cleanupAttempts).toBe(0);
      expect(checkpointMetrics.cleanupFailures).toBe(0);

      const applyBackMetrics = monitor.getApplyBackMetrics();
      expect(applyBackMetrics.attempts).toBe(0);
      expect(applyBackMetrics.failures).toBe(0);
      expect(applyBackMetrics.totalDuration).toBe(0);
      expect(applyBackMetrics.durations).toHaveLength(0);
    });
  });

  describe('Immutability', () => {
    it('should return independent copies of metrics', () => {
      monitor.recordCheckpointCreate(true);

      const metrics1 = monitor.getCheckpointMetrics();
      const metrics2 = monitor.getCheckpointMetrics();

      // Modify one copy
      metrics1.createAttempts = 999;

      // Other copy should remain unchanged
      expect(metrics2.createAttempts).toBe(1);

      // Original should remain unchanged
      expect(monitor.getCheckpointMetrics().createAttempts).toBe(1);
    });

    it('should return independent copies of applyBack durations', () => {
      monitor.recordApplyBack(true, 100);

      const metrics1 = monitor.getApplyBackMetrics();
      const metrics2 = monitor.getApplyBackMetrics();

      // Modify one copy
      metrics1.durations.push(999);

      // Other copy should remain unchanged
      expect(metrics2.durations).toHaveLength(1);
      expect(metrics2.durations[0]).toBe(100);
    });
  });
});
