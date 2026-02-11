import { describe, expect, it } from 'vitest';

import { applyPlanUpdate, summarizePlan } from '../../../src/core/plan/markdown-editor.js';

describe('plan markdown editor', () => {
  it('updates checkbox and sl:status with minimal edits', () => {
    const input = `# 🦑 Mission: Test

## 🗺️ Battle Plan (Execution)
- [ ] Do thing <!-- sl:id=stp_001 sl:status=todo -->
`;

    const res = applyPlanUpdate(input, {
      stepId: 'stp_001',
      patch: { status: 'active', checkbox: 'unchecked' },
      now: new Date('2026-02-11T10:00:00.000Z'),
    });

    expect(res.ok).toBe(true);
    expect(res.content).toContain('- [ ] Do thing <!-- sl:id=stp_001 sl:status=active');
  });

  it('appends subtasks under the target step', () => {
    const input = `# 🦑 Mission: Test

## 🗺️ Battle Plan (Execution)
- [ ] Parent <!-- sl:id=stp_001 sl:status=todo -->
`;

    const res = applyPlanUpdate(input, {
      stepId: 'stp_001',
      patch: { appendSubtasks: ['Sub 1', 'Sub 2'] },
      now: new Date('2026-02-11T10:00:00.000Z'),
    });

    expect(res.ok).toBe(true);
    expect(res.content).toMatch(/\n\s+- \[ \] Sub 1 <!-- sl:id=stp_001_/);
    expect(res.content).toMatch(/\n\s+- \[ \] Sub 2 <!-- sl:id=stp_001_/);

    const summary = summarizePlan(res.content);
    expect(summary.pending.length).toBeGreaterThanOrEqual(1);
  });

  it('records conflicts when stepId is missing', () => {
    const input = `# 🦑 Mission: Test

## 🗺️ Battle Plan (Execution)
- [ ] Parent <!-- sl:id=stp_001 sl:status=todo -->
`;

    const res = applyPlanUpdate(input, {
      stepId: 'stp_missing',
      patch: { status: 'active' },
      now: new Date('2026-02-11T10:00:00.000Z'),
    });

    expect(res.ok).toBe(false);
    expect(res.content).toContain('## ⚠️ Conflicts');
    expect(res.content).toContain('STEP_NOT_FOUND: sl:id=stp_missing');
  });
});
