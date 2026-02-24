/**
 * Tests for Context Effectiveness Tracker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
  ContextEffectivenessTracker,
  getEffectivenessTracker,
  resetEffectivenessTracker,
} from '../tracker.js';
import { DEFAULT_EFFECTIVENESS_CONFIG } from '../types.js';

describe('ContextEffectivenessTracker', () => {
  let tracker: ContextEffectivenessTracker;

  beforeEach(() => {
    tracker = new ContextEffectivenessTracker();
    resetEffectivenessTracker();
  });

  afterEach(() => {
    resetEffectivenessTracker();
  });

  describe('recordUsage', () => {
    it('should record file usage', () => {
      tracker.recordUsage('src/file.ts', true, 500, 85);

      const metrics = tracker.getMetrics();
      expect(metrics.totalFiles).toBe(1);
    });

    it('should track multiple records', () => {
      tracker.recordUsage('file1.ts', true, 500, 80);
      tracker.recordUsage('file2.ts', false, 300, 50);
      tracker.recordUsage('file3.ts', true, 400, 90);

      const metrics = tracker.getMetrics();
      expect(metrics.totalFiles).toBe(3);
    });

    it('should respect sample rate', () => {
      const samplingTracker = new ContextEffectivenessTracker({
        ...DEFAULT_EFFECTIVENESS_CONFIG,
        sampleRate: 0, // Never sample
      });

      samplingTracker.recordUsage('file.ts', true, 500, 80);

      const metrics = samplingTracker.getMetrics();
      expect(metrics.totalFiles).toBe(0);
    });

    it('should respect max records limit', () => {
      const limitedTracker = new ContextEffectivenessTracker({
        ...DEFAULT_EFFECTIVENESS_CONFIG,
        maxRecords: 5,
      });

      for (let i = 0; i < 10; i++) {
        limitedTracker.recordUsage(`file${i}.ts`, true, 100, 50);
      }

      const metrics = limitedTracker.getMetrics();
      expect(metrics.totalFiles).toBe(5);
    });
  });

  describe('recordFailure', () => {
    it('should record failures', () => {
      tracker.recordFailure('missing_context', 'Missing test file', ['file.ts']);

      const metrics = tracker.getMetrics();
      expect(metrics.failureBreakdown['missing_context']).toBe(1);
    });

    it('should track multiple failure types', () => {
      tracker.recordFailure('missing_context', 'Missing file');
      tracker.recordFailure('token_limit_exceeded', 'Too many tokens');
      tracker.recordFailure('missing_context', 'Another missing file');

      const metrics = tracker.getMetrics();
      expect(metrics.failureBreakdown['missing_context']).toBe(2);
      expect(metrics.failureBreakdown['token_limit_exceeded']).toBe(1);
    });
  });

  describe('recordExecution', () => {
    it('should track executions', () => {
      tracker.recordExecution(true, 1000);
      tracker.recordExecution(true, 1500);
      tracker.recordExecution(false, 2000);

      const metrics = tracker.getMetrics();
      expect(metrics.totalSessions).toBe(0); // Sessions tracked separately
    });
  });

  describe('getMetrics', () => {
    it('should calculate usage rate', () => {
      tracker.recordUsage('file1.ts', true, 500, 80);
      tracker.recordUsage('file2.ts', false, 300, 50);
      tracker.recordUsage('file3.ts', true, 400, 90);

      const metrics = tracker.getMetrics();
      expect(metrics.avgUsageRate).toBeCloseTo(0.667, 2);
    });

    it('should identify low usage files', () => {
      tracker.recordUsage('good.ts', true, 500, 80);
      tracker.recordUsage('good.ts', true, 500, 80);
      tracker.recordUsage('bad.ts', false, 300, 50);
      tracker.recordUsage('bad.ts', false, 300, 50);

      const metrics = tracker.getMetrics();
      expect(metrics.lowUsageFiles).toContain('bad.ts');
      expect(metrics.lowUsageFiles).not.toContain('good.ts');
    });

    it('should identify top referenced files', () => {
      for (let i = 0; i < 5; i++) {
        tracker.recordUsage('popular.ts', true, 100, 80);
      }
      tracker.recordUsage('unpopular.ts', true, 100, 80);

      const metrics = tracker.getMetrics();
      expect(metrics.topReferencedFiles).toContain('popular.ts');
    });

    it('should return zero metrics when no data', () => {
      const metrics = tracker.getMetrics();

      expect(metrics.totalFiles).toBe(0);
      expect(metrics.avgUsageRate).toBe(0);
      expect(metrics.tokenEfficiency).toBe(0);
    });
  });

  describe('getFileEffectiveness', () => {
    it('should return file summary', () => {
      tracker.recordUsage('file.ts', true, 500, 80);
      tracker.recordUsage('file.ts', false, 300, 60);

      const summary = tracker.getFileEffectiveness('file.ts');

      expect(summary).not.toBeNull();
      expect(summary?.timesIncluded).toBe(2);
      expect(summary?.timesReferenced).toBe(1);
      expect(summary?.usageRate).toBe(0.5);
    });

    it('should return null for unknown file', () => {
      const summary = tracker.getFileEffectiveness('unknown.ts');
      expect(summary).toBeNull();
    });
  });

  describe('getRecommendations', () => {
    it('should recommend improvement for low usage rate', () => {
      // Low usage rate scenario
      tracker.recordUsage('file1.ts', false, 500, 50);
      tracker.recordUsage('file2.ts', false, 500, 50);
      tracker.recordUsage('file3.ts', true, 500, 80);

      const recommendations = tracker.getRecommendations();

      expect(recommendations.some((r) => r.includes('Low context usage rate'))).toBe(true);
    });

    it('should recommend for missing context', () => {
      tracker.recordFailure('missing_context', 'Missing import', [], ['import.ts']);
      tracker.recordFailure('missing_context', 'Missing config', [], ['config.json']);
      tracker.recordFailure('missing_context', 'Missing types', [], ['types.ts']);
      tracker.recordFailure('missing_context', 'Another missing', [], ['other.ts']);

      const recommendations = tracker.getRecommendations();

      expect(
        recommendations.some(
          (r) => r.includes('missing context failures') || r.includes('Frequently missing context'),
        ),
      ).toBe(true);
    });
  });

  describe('reset', () => {
    it('should clear all data', () => {
      tracker.recordUsage('file.ts', true, 500, 80);
      tracker.recordFailure('missing_context', 'Test');
      tracker.startSession();

      tracker.reset();

      const metrics = tracker.getMetrics();
      expect(metrics.totalFiles).toBe(0);
      expect(metrics.totalSessions).toBe(0);
    });
  });
});

describe('Global instance', () => {
  it('should return singleton', () => {
    const instance1 = getEffectivenessTracker();
    const instance2 = getEffectivenessTracker();

    expect(instance1).toBe(instance2);
  });

  it('should reset singleton', () => {
    const instance1 = getEffectivenessTracker();
    resetEffectivenessTracker();
    const instance2 = getEffectivenessTracker();

    expect(instance1).not.toBe(instance2);
  });
});
