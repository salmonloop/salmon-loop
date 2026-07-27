import { beforeEach, describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  runPreflight: mock(),
  runAutopilot: mock(),
  runAutopilotVerifyGate: mock(),
  saveAudit: mock(),
}))();

mock.module('../../../../../src/core/grizzco/steps/preflight.js', () => ({
  runPreflight: hoisted.runPreflight,
}));

mock.module('../../../../../src/core/grizzco/steps/autopilot.js', () => ({
  runAutopilot: hoisted.runAutopilot,
  runAutopilotVerifyGate: hoisted.runAutopilotVerifyGate,
}));

mock.module('../../../../../src/core/grizzco/steps/display-report.js', () => ({
  displayReport: async (ctx: any) => ctx,
}));

mock.module('../../../../../src/core/grizzco/steps/audit.js', () => ({
  saveAudit: hoisted.saveAudit,
}));

describe('autopilot flow pipeline', () => {
  beforeEach(() => {
    hoisted.runPreflight.mockImplementation(async (ctx: any) => ({
      ...ctx,
      preflightResult: { ok: true },
    }));
    hoisted.runAutopilot.mockImplementation(async (ctx: any) => ({
      ...ctx,
      mutated: true,
      report: {
        kind: 'answer',
        summary: 'autopilot ready',
        timestamp: Date.now(),
      },
    }));
    hoisted.runAutopilotVerifyGate.mockImplementation(async (ctx: any) => ({
      ...ctx,
      verifyResult: { ok: true, output: 'ok', exitCode: 0 },
    }));
    hoisted.saveAudit.mockResolvedValue('/tmp/autopilot-audit.json');
  });

  it('executes the autopilot phases in order and carries verify results for mutated runs', async () => {
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
    expect((report.data as any)?.verifyResult).toEqual({
      ok: true,
      output: 'ok',
      exitCode: 0,
    });
  });

  it('skips verification work when the autopilot step did not mutate the workspace', async () => {
    const { executeAutopilotFlow } =
      await import('../../../../../src/core/grizzco/flows/AutopilotFlow.js');

    hoisted.runAutopilot.mockImplementationOnce(async (ctx: any) => ({
      ...ctx,
      mutated: false,
      report: {
        kind: 'answer',
        summary: 'autopilot ready',
        timestamp: Date.now(),
      },
    }));
    hoisted.runAutopilotVerifyGate.mockImplementationOnce(async (ctx: any) => ctx);

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
