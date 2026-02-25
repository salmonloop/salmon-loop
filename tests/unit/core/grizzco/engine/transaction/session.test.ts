import { LoopTelemetry } from '../../../../../../src/core/grizzco/engine/observability/loop-telemetry.js';
import { runFlowSession } from '../../../../../../src/core/grizzco/engine/transaction/session.js';

describe('transaction-session', () => {
  it('maps generic runner throw to LOOP_CRASH with VERIFY phase', async () => {
    const telemetry = new LoopTelemetry(() => new Date('2026-02-13T00:00:00.000Z'));
    const emitSanitized = mock();
    const runner = {
      execute: mock(async () => {
        throw new Error('boom');
      }),
    } as any;

    const session = await runFlowSession({
      runner,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
      now: () => new Date('2026-02-13T00:00:00.000Z'),
      emitSanitized,
    });

    expect(session.result.success).toBe(false);
    expect(session.result.reasonCode).toBe('LOOP_CRASH');
    expect(session.result.failurePhase).toBe('VERIFY');
    expect(emitSanitized).toHaveBeenCalledTimes(1);
  });
});
