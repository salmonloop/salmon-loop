import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';

import {
  persistEffectiveness,
  restoreEffectiveness,
} from '../../../src/core/context/effectiveness/persistence.js';
import {
  getEffectivenessTracker,
  resetEffectivenessTracker,
} from '../../../src/core/context/effectiveness/tracker.js';

describe('Effectiveness Persistence', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'effectiveness-test-'));
    resetEffectivenessTracker();
  });

  afterEach(async () => {
    resetEffectivenessTracker();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should persist and restore tracker state', async () => {
    const tracker = getEffectivenessTracker();
    tracker.startSession();
    tracker.recordUsage('src/foo.ts', true, 500, 80);
    tracker.recordUsage('src/bar.ts', false, 300, 40);
    tracker.recordExecution(true, 1000);
    tracker.recordExecution(false, 500);
    tracker.recordFailure('missing_context', 'missing type defs', ['src/types.ts']);

    await persistEffectiveness(tempDir);

    // Reset and verify clean state
    resetEffectivenessTracker();
    const freshTracker = getEffectivenessTracker();
    expect(freshTracker.getMetrics().totalSessions).toBe(0);

    // Restore
    await restoreEffectiveness(tempDir);
    const restored = getEffectivenessTracker();
    const metrics = restored.getMetrics();

    expect(metrics.totalSessions).toBe(1);
    expect(metrics.totalFiles).toBe(2);
    expect(metrics.avgUsageRate).toBeCloseTo(0.5); // 1 of 2 referenced
    expect(metrics.failureBreakdown['missing_context']).toBe(1);
  });

  it('should handle missing file gracefully', async () => {
    await restoreEffectiveness('/nonexistent/path');
    const tracker = getEffectivenessTracker();
    expect(tracker.getMetrics().totalSessions).toBe(0);
  });

  it('should handle corrupted JSON gracefully', async () => {
    const { writeFile, mkdir } = await import('fs/promises');
    const dir = join(tempDir, '.salmonloop', 'runtime');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'effectiveness.json'), 'not valid json', 'utf-8');

    await restoreEffectiveness(tempDir);
    const tracker = getEffectivenessTracker();
    expect(tracker.getMetrics().totalSessions).toBe(0);
  });

  it('should serialize and deserialize round-trip correctly', () => {
    const tracker = getEffectivenessTracker();
    tracker.startSession();
    tracker.startSession();
    tracker.recordUsage('file.ts', true, 100, 90);
    tracker.recordExecution(true, 200);

    const serialized = tracker.serialize();
    expect(serialized.sessionCount).toBe(2);
    expect(serialized.usageRecords).toHaveLength(1);
    expect(serialized.successfulExecutions).toBe(1);

    resetEffectivenessTracker();
    const fresh = getEffectivenessTracker();
    fresh.deserialize(serialized);

    const metrics = fresh.getMetrics();
    expect(metrics.totalSessions).toBe(2);
    expect(metrics.totalFiles).toBe(1);
  });
});
