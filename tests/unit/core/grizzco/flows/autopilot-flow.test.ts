import { describe, expect, it, mock } from 'bun:test';

mock.module('../../../../../src/core/grizzco/steps/preflight.js', () => ({
  runPreflight: async (ctx: any) => ({ ...ctx, preflightResult: { ok: true } }),
}));

mock.module('../../../../../src/core/grizzco/steps/autopilot.js', () => ({
  runAutopilot: async (ctx: any) => ({
    ...ctx,
    mutated: false,
    report: {
      kind: 'answer',
      summary: 'autopilot ready',
      timestamp: Date.now(),
    },
  }),
  runAutopilotVerifyGate: async (ctx: any) => ctx,
}));

mock.module('../../../../../src/core/grizzco/steps/display-report.js', () => ({
  displayReport: async (ctx: any) => ctx,
}));

mock.module('../../../../../src/core/grizzco/steps/audit.js', () => ({
  saveAudit: async () => '/tmp/autopilot-audit.json',
}));

describe('autopilot flow pipeline', () => {
  it('executes the autopilot phases in order', async () => {
    const { executeAutopilotFlow } =
      await import('../../../../../src/core/grizzco/flows/AutopilotFlow.js');

    const report = await executeAutopilotFlow({
      workspace: { baseRepoPath: '/tmp', workPath: '/tmp', strategy: 'direct' },
      options: { instruction: 'inspect and act', llm: {} as any },
      mode: 'autopilot',
      fs: {
        readFile: async () => '',
        writeFile: async () => {},
        exists: async () => false,
        mkdir: async () => {},
      },
      emit: () => {},
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect(report.traces.map((trace) => trace.name)).toEqual([
      'PREFLIGHT',
      'AUTOPILOT',
      'VERIFY_GATE',
      'REPORT',
    ]);
    expect(report.auditPath).toBe('/tmp/autopilot-audit.json');
    expect(report.strategyName).toBe('autopilot');
    expect(report.fsMode).toBe('autopilot');
  });

  it('skips verification work when the autopilot step did not mutate the workspace', async () => {
    const { executeAutopilotFlow } =
      await import('../../../../../src/core/grizzco/flows/AutopilotFlow.js');

    const report = await executeAutopilotFlow({
      workspace: { baseRepoPath: '/tmp', workPath: '/tmp', strategy: 'direct' },
      options: { instruction: 'inspect and act', llm: {} as any },
      mode: 'autopilot',
      fs: {
        readFile: async () => '',
        writeFile: async () => {},
        exists: async () => false,
        mkdir: async () => {},
      },
      emit: () => {},
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect((report.data as any)?.mutated).toBe(false);
    expect((report.data as any)?.verifyResult).toBeUndefined();
  });
});
