import { beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';

const hoisted = (() => ({
  flags: {
    isCommanderError: false,
    shouldExitCommanderError: false,
    commanderExitCode: 1,
  },
  calls: {
    emitUsage: 0,
    reportCrash: 0,
    parseAsync: 0,
    exitCodes: [] as number[],
  },
  context: {
    program: {
      parseAsync: async (_argv: string[]) => undefined,
      configureOutput: () => undefined,
      showHelpAfterError: () => undefined,
      showSuggestionAfterError: () => undefined,
    },
    rewrittenArgv: ['bun', 'src/cli/index.ts', 'run'],
    headlessDetection: { outputFormat: null },
  } as any,
}))();

mock.module('../../../src/cli/commander-error-adapter.js', () => ({
  isCommanderError: mock((_err: unknown) => hoisted.flags.isCommanderError),
  shouldExitCommanderError: mock((_err: unknown) => hoisted.flags.shouldExitCommanderError),
  getCommanderErrorExitCode: mock((_err: unknown) => hoisted.flags.commanderExitCode),
  emitHeadlessCommanderUsageError: mock((_params: unknown) => {
    hoisted.calls.emitUsage += 1;
  }),
}));

mock.module('../../../src/cli/crash-reporter.js', () => ({
  reportCliCrash: mock((_err: unknown) => {
    hoisted.calls.reportCrash += 1;
  }),
}));

describe('parseProgramOrExit', () => {
  beforeEach(() => {
    hoisted.flags.isCommanderError = false;
    hoisted.flags.shouldExitCommanderError = false;
    hoisted.flags.commanderExitCode = 1;
    hoisted.calls.emitUsage = 0;
    hoisted.calls.reportCrash = 0;
    hoisted.calls.parseAsync = 0;
    hoisted.calls.exitCodes = [];
    hoisted.context.program.parseAsync = async (_argv: string[]) => {
      hoisted.calls.parseAsync += 1;
    };
  });

  it('returns ok when parse succeeds', async () => {
    const { parseProgramOrExit } = await import('../../../src/cli/program-parse.js');
    const result = await parseProgramOrExit(hoisted.context);

    expect(result).toEqual({ status: 'ok' });
    expect(hoisted.calls.parseAsync).toBe(1);
    expect(hoisted.calls.emitUsage).toBe(0);
    expect(hoisted.calls.reportCrash).toBe(0);
  });

  it('returns ok for commander help-like errors without exit', async () => {
    const { parseProgramOrExit } = await import('../../../src/cli/program-parse.js');
    hoisted.flags.isCommanderError = true;
    hoisted.flags.shouldExitCommanderError = false;
    hoisted.context.program.parseAsync = async () => {
      throw new Error('commander');
    };

    const result = await parseProgramOrExit(hoisted.context);
    expect(result).toEqual({ status: 'ok' });
    expect(hoisted.calls.emitUsage).toBe(1);
    expect(hoisted.calls.reportCrash).toBe(0);
  });

  it('returns exited and calls process.exit for commander exit errors', async () => {
    const { parseProgramOrExit } = await import('../../../src/cli/program-parse.js');
    hoisted.flags.isCommanderError = true;
    hoisted.flags.shouldExitCommanderError = true;
    hoisted.flags.commanderExitCode = 7;
    hoisted.context.program.parseAsync = async () => {
      throw new Error('commander-exit');
    };

    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      hoisted.calls.exitCodes.push(code ?? 0);
      return undefined as never;
    }) as any);

    try {
      const result = await parseProgramOrExit(hoisted.context);
      expect(result).toEqual({ status: 'exited' });
      expect(hoisted.calls.exitCodes).toEqual([7]);
      expect(hoisted.calls.reportCrash).toBe(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it('returns crash-reported for non-commander errors', async () => {
    const { parseProgramOrExit } = await import('../../../src/cli/program-parse.js');
    hoisted.flags.isCommanderError = false;
    hoisted.context.program.parseAsync = async () => {
      throw new Error('boom');
    };

    const result = await parseProgramOrExit(hoisted.context);
    expect(result).toEqual({ status: 'crash-reported' });
    expect(hoisted.calls.reportCrash).toBe(1);
    expect(hoisted.calls.emitUsage).toBe(0);
  });
});
