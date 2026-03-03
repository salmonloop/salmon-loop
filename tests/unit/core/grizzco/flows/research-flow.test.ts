import { describe, expect, it, mock } from 'bun:test';

mock.module('../../../../../src/core/grizzco/steps/preflight.js', () => ({
  runPreflight: async (ctx: any) => ({ ...ctx, preflightResult: { ok: true } }),
}));

mock.module('../../../../../src/core/grizzco/steps/prepare-deps.js', () => ({
  runPrepareDeps: async (ctx: any) => ctx,
}));

mock.module('../../../../../src/core/grizzco/steps/context.js', () => ({
  buildContext: async (ctx: any) => ({ ...ctx, context: { files: [] } }),
}));

mock.module('../../../../../src/core/grizzco/steps/explore.js', () => ({
  exploreCodebase: async (ctx: any) => ctx,
}));

mock.module('../../../../../src/core/grizzco/steps/research.js', () => ({
  generateResearch: async (ctx: any) => ({
    ...ctx,
    researchNotes: [],
    researchFindings: [],
    sources: [],
    researchText: 'ok',
  }),
}));

mock.module('../../../../../src/core/grizzco/steps/display-report.js', () => ({
  displayReport: async (ctx: any) => ctx,
}));

mock.module('../../../../../src/core/grizzco/steps/read-only-shrink.js', () => ({
  runReadOnlyShrink: async (ctx: any) => ({ ...ctx, shrunk: true }),
}));

mock.module('../../../../../src/core/grizzco/steps/audit.js', () => ({
  saveAudit: async () => '/tmp/audit.json',
}));

describe('research flow pipeline', () => {
  it('executes research phases in order', async () => {
    const { executeSalmonLoopFlow } =
      await import('../../../../../src/core/grizzco/flows/SalmonLoopFlow.js');

    const report = await executeSalmonLoopFlow({
      workspace: { baseRepoPath: '/tmp', workPath: '/tmp', strategy: 'direct' },
      options: {},
      mode: 'research',
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

    const steps = report.traces.map((trace) => trace.name);
    expect(steps).toEqual([
      'PREFLIGHT',
      'PREPARE_DEPS',
      'CONTEXT',
      'EXPLORE',
      'RESEARCH',
      'REPORT',
      'SHRINK',
    ]);
  });
});
