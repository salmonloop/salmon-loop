import { Pipeline } from '../../../../../../src/core/grizzco/engine/pipeline/pipeline.js';
import type { LoopEvent } from '../../../../../../src/core/types/index.js';

describe('pipeline APPLY_BACK reporting', () => {
  it('emits phase.end success=false when applyBackResult fails without throwing', async () => {
    const events: LoopEvent[] = [];
    const emit = (event: LoopEvent) => events.push(event);

    const ctx: any = {
      emit,
      attempt: 1,
    };

    const pipeline = Pipeline.of(ctx).step('APPLY_BACK', async (input) => {
      return {
        ...input,
        applyBackResult: {
          success: false,
          skipped: false,
          telemetry: {},
          safeMessage: 'Apply-back failed (test)',
          errorCode: 'APPLY_BACK_FAILED',
        },
      };
    });

    const report = await pipeline.execute();

    expect(report.success).toBe(true);
    const phaseEnd = events.find(
      (e) => e.type === 'phase.end' && (e as any).phase === 'APPLY_BACK',
    ) as any;
    expect(phaseEnd).toBeTruthy();
    expect(phaseEnd.success).toBe(false);

    const span = report.traces.find((t) => t.name === 'APPLY_BACK');
    expect(span?.error).toBe('Apply-back failed (test)');
  });

  it('reports the last executed step instead of the last declared step on failure', async () => {
    const pipeline = Pipeline.of({})
      .step('EXPLORE', async (input) => input)
      .step('PLAN', async () => {
        throw new Error('plan failed');
      })
      .step('PATCH', async (input) => input);

    const report = await pipeline.execute();

    expect(report.success).toBe(false);
    expect(report.lastStep).toBe('PLAN');
  });
});
