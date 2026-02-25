import { Pipeline } from '../../../../../src/core/grizzco/engine/pipeline/pipeline.js';

describe('Pipeline', () => {
  it('should execute linear steps', async () => {
    const init = { val: 0 };
    const step1 = async (ctx: typeof init) => ({ val: ctx.val + 1 });
    const step2 = async (ctx: typeof init) => ({ val: ctx.val + 2 });

    const result = await Pipeline.of(init).step('S1', step1).step('S2', step2).execute();

    expect(result.success).toBe(true);
    expect(result.data?.val).toBe(3);
    expect(result.traces).toHaveLength(2);
  });

  it('should handle errors and recovery', async () => {
    const init = { val: 0 };
    const failStep = async () => {
      throw new Error('Boom');
    };
    const recoverStep = mock();

    const result = await Pipeline.of(init)
      .stepWithRecovery('FAIL', failStep, recoverStep)
      .execute();

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Boom');
    expect(recoverStep).toHaveBeenCalled();
    // Trace should include recovery
    const recoveryTrace = result.traces.find((t) => t.name.includes(':recovery'));
    expect(recoveryTrace).toBeDefined();
  });

  it('should short-circuit worktree pipelines when signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const emit = mock();
    const step = mock(async (ctx: any) => ({ ...ctx, val: (ctx.val ?? 0) + 1 }));

    const init = {
      val: 0,
      emit,
      options: { signal: controller.signal, strategy: 'worktree' },
      workspace: { strategy: 'worktree' },
    };

    const result = await Pipeline.of(init).step('PREFLIGHT', step).execute();

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Operation cancelled by user');
    expect(step).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('should not run recovery on abort short-circuit', async () => {
    const controller = new AbortController();
    controller.abort();

    const emit = mock();
    const action = mock(async () => ({ ok: true }));
    const recovery = mock(async () => ({ ok: true }));

    const init = {
      emit,
      options: { signal: controller.signal, strategy: 'worktree' },
      workspace: { strategy: 'worktree' },
    };

    const result = await Pipeline.of(init).stepWithRecovery('APPLY', action, recovery).execute();

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Operation cancelled by user');
    expect(action).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
