import { runFlowSession } from '../../../../../src/core/grizzco/flows/flow-session.js';
import { LoopTelemetry } from '../../../../../src/core/grizzco/flows/flow-telemetry.js';

describe('flow-session', () => {
  it('maps generic runner throw to LOOP_CRASH with VERIFY phase', async () => {
    const telemetry = new LoopTelemetry(() => new Date('2026-02-13T00:00:00.000Z'));
    const emitSanitized = vi.fn();
    const runner = {
      execute: vi.fn(async () => {
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
