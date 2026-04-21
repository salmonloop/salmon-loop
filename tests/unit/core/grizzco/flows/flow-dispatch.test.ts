import { describe, expect, it, mock } from 'bun:test';

mock.module('../../../../../src/core/grizzco/flows/SalmonLoopFlow.js', () => ({
  executeSalmonLoopFlow: mock(async (ctx: any) => ({
    success: true,
    duration: 1,
    traces: [{ name: 'RECIPE' }],
    data: ctx,
  })),
}));

mock.module('../../../../../src/core/grizzco/flows/AutopilotFlow.js', () => ({
  executeAutopilotFlow: mock(async (ctx: any) => ({
    success: true,
    duration: 1,
    traces: [{ name: 'AUTOPILOT' }],
    data: ctx,
  })),
}));

describe('flow dispatch', () => {
  it('routes autopilot mode to AutopilotFlow', async () => {
    const { executeFlowAttempt } =
      await import('../../../../../src/core/grizzco/flows/flow-dispatch.js');

    const report = await executeFlowAttempt({
      mode: 'autopilot',
      options: { instruction: 'act', llm: {} as any },
    } as any);

    expect(report.traces.map((trace) => trace.name)).toEqual(['AUTOPILOT']);
  });

  it('routes recipe modes to SalmonLoopFlow', async () => {
    const { executeFlowAttempt } =
      await import('../../../../../src/core/grizzco/flows/flow-dispatch.js');

    const report = await executeFlowAttempt({
      mode: 'patch',
      options: { instruction: 'act', llm: {} as any },
    } as any);

    expect(report.traces.map((trace) => trace.name)).toEqual(['RECIPE']);
  });
});
