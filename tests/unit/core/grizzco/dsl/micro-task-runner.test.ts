import { DecisionEngine } from '../../../../../src/core/grizzco/dsl/DecisionEngine.js';
import { MicroTaskRunner } from '../../../../../src/core/grizzco/dsl/MicroTaskRunner.js';

interface TestCtx {
  data?: Record<string, unknown>;
}

describe('micro-task-runner', () => {
  it('resolves declared data dependencies before producing plan', async () => {
    const resolveData = vi.fn(async () => 'bar');
    const runner = new MicroTaskRunner<TestCtx>({
      strategy: (engine: DecisionEngine<TestCtx>) =>
        engine
          .phase('test')
          .requireData('foo')
          .when(
            (ctx) => ctx.data?.foo === 'bar',
            (plan) => plan.setWorker('direct-write'),
          ),
      resolveData,
      debugLabel: 'a.ts',
    });

    const result = await runner.decide({ data: {} });

    expect(resolveData).toHaveBeenCalledTimes(1);
    expect(result.plan.workerId).toBe('direct-write');
    expect(result.decisions.length).toBeGreaterThan(0);
  });

  it('fails fast when dependency loop exceeds max rounds', async () => {
    const runner = new MicroTaskRunner<TestCtx>({
      strategy: (engine: DecisionEngine<TestCtx>) => engine.requireData('never-ready'),
      resolveData: async () => undefined,
      maxRounds: 1,
      debugLabel: 'b.ts',
    });

    await expect(runner.decide({ data: {} })).rejects.toThrow();
  });
});
