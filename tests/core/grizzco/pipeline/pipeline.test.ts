import { describe, it, expect, vi } from 'vitest';

import { Pipeline } from '../../../../src/core/grizzco/pipeline.js';

describe('Pipeline (V3)', () => {
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
    const recoverStep = vi.fn();

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
});
