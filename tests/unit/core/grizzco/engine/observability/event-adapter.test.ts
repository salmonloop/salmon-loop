import { createFlowEventAdapter } from '../../../../../../src/core/grizzco/engine/observability/event-adapter.js';
import { LoopTelemetry } from '../../../../../../src/core/grizzco/engine/observability/loop-telemetry.js';
import type { LoopEvent } from '../../../../../../src/core/types.js';

describe('event-adapter', () => {
  it('records sanitized direct logs as PREFLIGHT', () => {
    const onEvent = vi.fn();
    const telemetry = new LoopTelemetry(() => new Date('2026-02-13T00:00:00.000Z'));
    const adapter = createFlowEventAdapter({ onEvent, telemetry });

    const event: LoopEvent = {
      type: 'log',
      level: 'info',
      message: 'host boot ok',
      timestamp: new Date(),
    };

    adapter.emitSanitized(event);

    const logs = telemetry.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.step).toBe('PREFLIGHT');
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'log' }));
  });

  it('tracks current phase for flow logs', () => {
    const telemetry = new LoopTelemetry(() => new Date('2026-02-13T00:00:00.000Z'));
    const adapter = createFlowEventAdapter({ telemetry });

    adapter.emitFlow({ type: 'phase.start', phase: 'PLAN', timestamp: new Date() });
    adapter.emitFlow({
      type: 'log',
      level: 'info',
      message: 'planning',
      timestamp: new Date(),
    });
    adapter.emitFlow({ type: 'phase.end', phase: 'PLAN', success: true, timestamp: new Date() });

    const logs = telemetry.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.step).toBe('PLAN');
  });
});
