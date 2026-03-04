import { beforeEach, describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  calls: [] as string[],
  lastArgs: {
    contextProgram: undefined as unknown,
    contextArgv: undefined as unknown,
    outputContext: undefined as unknown,
    parseContext: undefined as unknown,
  },
  program: { name: 'program-stub' } as any,
  context: { program: { name: 'ctx-program' }, rewrittenArgv: [], headlessDetection: {} } as any,
}))();

mock.module('../../../src/cli/program-bootstrap.js', () => ({
  bootstrapProgram: mock(() => {
    hoisted.calls.push('bootstrapProgram');
    return hoisted.program;
  }),
}));

mock.module('../../../src/cli/program-options.js', () => ({
  configureGlobalProgramOptions: mock((program: unknown) => {
    hoisted.calls.push('configureGlobalProgramOptions');
    expect(program).toBe(hoisted.program);
  }),
}));

mock.module('../../../src/cli/program-commands.js', () => ({
  registerProgramCommands: mock((program: unknown) => {
    hoisted.calls.push('registerProgramCommands');
    expect(program).toBe(hoisted.program);
  }),
}));

mock.module('../../../src/cli/cli-runtime-context.js', () => ({
  createCliRuntimeContext: mock((program: unknown, argv: unknown) => {
    hoisted.calls.push('createCliRuntimeContext');
    hoisted.lastArgs.contextProgram = program;
    hoisted.lastArgs.contextArgv = argv;
    return hoisted.context;
  }),
}));

mock.module('../../../src/cli/program-output-mode.js', () => ({
  configureProgramOutputForHeadless: mock((context: unknown) => {
    hoisted.calls.push('configureProgramOutputForHeadless');
    hoisted.lastArgs.outputContext = context;
  }),
}));

mock.module('../../../src/cli/program-parse.js', () => ({
  parseProgramOrExit: mock(async (context: unknown) => {
    hoisted.calls.push('parseProgramOrExit');
    hoisted.lastArgs.parseContext = context;
  }),
}));

describe('run-cli pipeline', () => {
  beforeEach(() => {
    hoisted.calls = [];
    hoisted.lastArgs.contextProgram = undefined;
    hoisted.lastArgs.contextArgv = undefined;
    hoisted.lastArgs.outputContext = undefined;
    hoisted.lastArgs.parseContext = undefined;
    hoisted.program = { name: 'program-stub' };
    hoisted.context = {
      program: hoisted.program,
      rewrittenArgv: ['bun', 'src/cli/index.ts'],
      headlessDetection: { outputFormat: null },
    };
  });

  it('buildCliProgram wires bootstrap + global options + command registration', async () => {
    const { buildCliProgram } = await import('../../../src/cli/run-cli.js');
    const program = buildCliProgram();

    expect(program).toBe(hoisted.program);
    expect(hoisted.calls).toEqual([
      'bootstrapProgram',
      'configureGlobalProgramOptions',
      'registerProgramCommands',
    ]);
  });

  it('createCliContextFromArgv builds program and derives runtime context', async () => {
    const { createCliContextFromArgv } = await import('../../../src/cli/run-cli.js');
    const argv = ['bun', 'src/cli/index.ts', 'run', '-p', 'fix'];

    const context = createCliContextFromArgv(argv);

    expect(context).toBe(hoisted.context);
    expect(hoisted.lastArgs.contextProgram).toBe(hoisted.program);
    expect(hoisted.lastArgs.contextArgv).toBe(argv);
    expect(hoisted.calls).toEqual([
      'bootstrapProgram',
      'configureGlobalProgramOptions',
      'registerProgramCommands',
      'createCliRuntimeContext',
    ]);
  });

  it('executeCliContext configures output mode before parse', async () => {
    const { executeCliContext } = await import('../../../src/cli/run-cli.js');
    await executeCliContext(hoisted.context);

    expect(hoisted.lastArgs.outputContext).toBe(hoisted.context);
    expect(hoisted.lastArgs.parseContext).toBe(hoisted.context);
    expect(hoisted.calls).toEqual(['configureProgramOutputForHeadless', 'parseProgramOrExit']);
  });

  it('runCli executes the full pipeline from argv', async () => {
    const { runCli } = await import('../../../src/cli/run-cli.js');
    const argv = ['bun', 'src/cli/index.ts', 'chat'];

    await runCli(argv);

    expect(hoisted.lastArgs.contextProgram).toBe(hoisted.program);
    expect(hoisted.lastArgs.contextArgv).toBe(argv);
    expect(hoisted.lastArgs.outputContext).toBe(hoisted.context);
    expect(hoisted.lastArgs.parseContext).toBe(hoisted.context);
    expect(hoisted.calls).toEqual([
      'bootstrapProgram',
      'configureGlobalProgramOptions',
      'registerProgramCommands',
      'createCliRuntimeContext',
      'configureProgramOutputForHeadless',
      'parseProgramOrExit',
    ]);
  });
});
