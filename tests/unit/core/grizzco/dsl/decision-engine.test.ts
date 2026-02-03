import { DecisionEngine } from '../../../../../src/core/grizzco/dsl/DecisionEngine.js';
import { createMockContext, createMockPlanBuilder } from '../mocks.js';

describe('DecisionEngine', () => {
  it('should return PLAN when no data is required', () => {
    const ctx = createMockContext();
    const pb = createMockPlanBuilder();
    const engine = new DecisionEngine(ctx, pb);

    engine.phase('Test').when(
      () => true,
      (p) => p.setWorker('test-worker'),
    );

    const result = engine.build();
    expect(result.type).toBe('PLAN');
    if (result.type === 'PLAN') {
      expect(result.plan.workerId).toBe('test-worker');
    }
  });

  it('should return NEED_DATA when data is missing', () => {
    const ctx = createMockContext({ data: {} });
    const pb = createMockPlanBuilder();
    const engine = new DecisionEngine(ctx, pb);

    engine.requireData('remote_lock');

    const result = engine.build();
    expect(result.type).toBe('NEED_DATA');
    if (result.type === 'NEED_DATA') {
      expect(result.keys).toEqual(['remote_lock']);
    }
  });

  it('should continue when data is present', () => {
    const ctx = createMockContext({ data: { remote_lock: { isLocked: false } } });
    const pb = createMockPlanBuilder();
    const engine = new DecisionEngine(ctx, pb);

    engine.requireData('remote_lock').when(
      (c) => !c.data!.remote_lock.isLocked,
      (p) => p.setWorker('unlocked-worker'),
    );

    const result = engine.build();
    expect(result.type).toBe('PLAN');
    if (result.type === 'PLAN') {
      expect(result.plan.workerId).toBe('unlocked-worker');
    }
  });
});
