import path from 'path';

import { describe, expect, it } from 'vitest';

import { initPlan, readPlan, updatePlan } from '../../src/core/plan/index.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('plan manager (integration)', () => {
  it('creates, reads, and updates a runtime plan under .salmonloop/plans/', async () => {
    const helper = new RealFsTestHelper();
    const persistenceRoot = await helper.createTempDir('salmon-plan-');

    const init = await initPlan({
      persistenceRoot,
      mission: 'Test Mission',
      objective: 'Test Objective',
      context: 'Test Context',
    });

    expect(
      await helper.fileExists(
        persistenceRoot,
        path.join('.salmonloop', 'plans', init.sessionId, 'SALMONLOOP_PLAN.md'),
      ),
    ).toBe(true);

    const first = await readPlan({ persistenceRoot, sessionId: init.sessionId });
    expect(first.baseHash).toBe(init.baseHash);
    expect(first.active.length).toBeGreaterThan(0);

    const stepId = first.active[0].stepId;
    const updated = await updatePlan({
      persistenceRoot,
      sessionId: init.sessionId,
      baseHash: first.baseHash,
      stepId,
      patch: { appendSubtasks: ['Task A'], note: 'Starting work' },
      now: new Date('2026-02-11T10:00:00.000Z'),
    });
    expect(updated.ok).toBe(true);

    const second = await readPlan({ persistenceRoot, sessionId: init.sessionId });
    expect(second.active.map((s) => s.stepId)).toContain(stepId);
    expect(second.pending.map((s) => s.text)).toContain('Task A');

    const conflict = await updatePlan({
      persistenceRoot,
      sessionId: init.sessionId,
      baseHash: first.baseHash, // stale
      stepId,
      patch: { status: 'done' },
      now: new Date('2026-02-11T10:00:00.000Z'),
    });
    expect(conflict.ok).toBe(false);
    if (conflict.ok === false) {
      expect(conflict.conflict.code).toBe('BASE_HASH_MISMATCH');
    }

    await helper.cleanup();
  });
});
