import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';

const hoisted = (() => ({
  standardReporterCtor: vi.fn(),
  startGuiCalled: vi.fn(),
}))();

vi.mock('../../../../src/cli/reporters/standard.js', () => ({
  StandardReporter: function StandardReporter(this: any, verbose: boolean) {
    hoisted.standardReporterCtor(verbose);
    return {
      onStart: vi.fn(),
      onEvent: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
    };
  },
}));
vi.mock('../../../../src/cli/reporters/standard.ts', () => ({
  StandardReporter: function StandardReporter(this: any, verbose: boolean) {
    hoisted.standardReporterCtor(verbose);
    return {
      onStart: vi.fn(),
      onEvent: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
    };
  },
}));

vi.mock('../../../../src/core/plugin/loader.js', () => ({
  PluginLoader: { loadPlugins: vi.fn(async () => {}) },
}));

vi.mock('../../../../src/core/config/index.js', () => ({
  ConfigError: class ConfigError extends Error {},
  resolveConfig: vi.fn(async () => ({
    raw: { version: 1 },
    source: { used: false, path: undefined },
    observability: { langfuse: { enabled: false, outcome: false, endpoint: undefined } },
    llmOutput: { kinds: [] },
    markdownTheme: 'default',
    markdownRenderMode: 'enhanced',
    verify: { command: 'bun -e "process.exit(0)"' },
    llm: { type: 'stub', clientPackage: undefined },
    toolAuthorization: { allowlist: {} },
  })),
  redactConfigForPrint: (v: any) => v,
}));

vi.mock('../../../../src/core/extensions/index.js', () => ({
  ExtensionConfigError: class ExtensionConfigError extends Error {},
  resolveExtensions: vi.fn(async () => ({ resolved: [] })),
}));

vi.mock('../../../../src/core/session/manager.js', () => ({
  ChatSessionManager: class ChatSessionManager {
    private current: any;
    constructor(private repoPath: string) {}
    async init() {}
    async loadLast() {
      return null;
    }
    async resumeSession(_id: string) {
      throw new Error('Session not found');
    }
    async create() {
      this.current = {
        meta: {
          id: 'sess-1',
          name: 'Test',
          repoPath: this.repoPath,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          totalIterations: 0,
          successfulIterations: 0,
          totalTokens: { input: 0, output: 0 },
          snapshots: [],
        },
        messages: [],
        iterations: [],
      };
      return this.current;
    }
    addMessage() {}
    addIteration() {
      return 'iter-1';
    }
    getCurrent() {
      return this.current;
    }
    async save() {}
  },
}));
vi.mock('../../../../src/core/session/manager.ts', () => ({
  ChatSessionManager: class ChatSessionManager {
    private current: any;
    constructor(private repoPath: string) {}
    async init() {}
    async loadLast() {
      return null;
    }
    async resumeSession(_id: string) {
      throw new Error('Session not found');
    }
    async create() {
      this.current = {
        meta: {
          id: 'sess-1',
          name: 'Test',
          repoPath: this.repoPath,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          totalIterations: 0,
          successfulIterations: 0,
          totalTokens: { input: 0, output: 0 },
          snapshots: [],
        },
        messages: [],
        iterations: [],
      };
      return this.current;
    }
    addMessage() {}
    addIteration() {
      return 'iter-1';
    }
    getCurrent() {
      return this.current;
    }
    async save() {}
  },
}));

vi.mock('../../../../src/core/llm/factory.js', () => ({
  createRuntimeLlm: vi.fn(() => ({
    llm: {
      chat: vi.fn(async () => ({ role: 'assistant', content: 'ok' })),
      createPlan: vi.fn(async () => ({ goal: 'x', files: [], changes: [], verify: '' })),
      createPatch: vi.fn(async () => ''),
      getModelId: () => 'test',
    },
    warnings: [],
  })),
}));

vi.mock('../../../../src/core/runtime/loop.js', () => ({
  runSalmonLoop: vi.fn(async () => ({ success: true, attempts: 1, changedFiles: [] })),
}));

vi.mock('../../../../src/cli/ui/index.js', () => ({
  startGUI: vi.fn(async (_mode: any, _sessionManager: any, runFn: any) => {
    hoisted.startGuiCalled();
    return runFn(() => {}, undefined, { signal: new AbortController().signal });
  }),
}));
vi.mock('../../../../src/cli/ui/index.tsx', () => ({
  startGUI: vi.fn(async (_mode: any, _sessionManager: any, runFn: any) => {
    hoisted.startGuiCalled();
    return runFn(() => {}, undefined, { signal: new AbortController().signal });
  }),
}));

vi.mock('../../../../src/cli/utils/verify-resolver.js', () => ({
  resolveVerifyOption: vi.fn(async (_repoRoot: string, cliVerify?: string, cfgVerify?: string) => {
    return cliVerify ?? cfgVerify ?? 'bun -e "process.exit(0)"';
  }),
}));

vi.mock('../../../../src/cli/utils/llm-output.js', () => ({
  resolveLlmOutputPolicyFromCli: vi.fn(() => ({ ok: true, policy: { kinds: [] } })),
}));

vi.mock('../../../../src/cli/authorization/provider.js', () => ({
  createTerminalAuthorizationProvider: vi.fn(() => ({ type: 'terminal' })),
  createUiAuthorizationProvider: vi.fn(() => ({ type: 'ui' })),
}));

describe('handleRunCommand GUI mode', () => {
  const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  let exitSpy: any;

  beforeEach(() => {
    hoisted.standardReporterCtor.mockClear();
    hoisted.startGuiCalled.mockClear();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as any);
  });

  afterEach(() => {
    exitSpy?.mockRestore();
    process.exitCode = 0;
    if (originalIsTTY) {
      Object.defineProperty(process.stdout, 'isTTY', originalIsTTY);
    }
  });

  it('does not construct StandardReporter when GUI is enabled', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });

    const { handleRunCommand } = await import('../../../../src/cli/commands/run.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: process.cwd(),
        print: undefined,
        instruction: 'test',
        mode: 'patch',
        configFile: true,
        config: undefined,
        printConfig: false,
        validate: false,
        llmOutput: undefined,
        verify: 'bun -e "process.exit(0)"',
        dryRun: true,
        forceReset: false,
        verbose: false,
        checkpointStrategy: 'worktree',
        applyBackOnDirty: '3way',
        worktreePrepare: undefined,
        streamOutput: false,
        outputFormat: 'text',
        gui: true,
        file: undefined,
        selection: undefined,
      }),
      help: () => {},
    };

    await handleRunCommand({}, command).catch(() => {});
    expect(hoisted.standardReporterCtor).not.toHaveBeenCalled();
  });

  it('constructs StandardReporter when GUI is disabled', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });

    const { handleRunCommand } = await import('../../../../src/cli/commands/run.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: process.cwd(),
        print: undefined,
        instruction: 'test',
        mode: 'patch',
        configFile: true,
        config: undefined,
        printConfig: false,
        validate: false,
        llmOutput: undefined,
        verify: 'bun -e "process.exit(0)"',
        dryRun: true,
        forceReset: false,
        verbose: false,
        checkpointStrategy: 'worktree',
        applyBackOnDirty: '3way',
        worktreePrepare: undefined,
        streamOutput: false,
        outputFormat: 'text',
        gui: false,
        file: undefined,
        selection: undefined,
      }),
      help: () => {},
    };

    await handleRunCommand({}, command).catch(() => {});
    expect(hoisted.standardReporterCtor).toHaveBeenCalledTimes(1);
  });

  it('disables GUI when output format is stream-json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });

    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true as any);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true as any);

    const { handleRunCommand } = await import('../../../../src/cli/commands/run.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: process.cwd(),
        print: undefined,
        instruction: 'test',
        mode: 'patch',
        configFile: true,
        config: undefined,
        printConfig: false,
        validate: false,
        llmOutput: undefined,
        verify: 'bun -e "process.exit(0)"',
        dryRun: true,
        forceReset: false,
        verbose: false,
        checkpointStrategy: 'worktree',
        applyBackOnDirty: '3way',
        worktreePrepare: undefined,
        streamOutput: false,
        outputFormat: 'stream-json',
        gui: true,
        file: undefined,
        selection: undefined,
      }),
      help: () => {},
    };

    await handleRunCommand({}, command).catch(() => {});
    expect(hoisted.startGuiCalled).not.toHaveBeenCalled();
    expect(hoisted.standardReporterCtor).not.toHaveBeenCalled();

    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it('disables GUI when print mode is set', async () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });

    const { handleRunCommand } = await import('../../../../src/cli/commands/run.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: process.cwd(),
        print: 'test',
        instruction: undefined,
        mode: 'patch',
        configFile: true,
        config: undefined,
        printConfig: false,
        validate: false,
        llmOutput: undefined,
        verify: 'bun -e "process.exit(0)"',
        dryRun: true,
        forceReset: false,
        verbose: false,
        checkpointStrategy: 'worktree',
        applyBackOnDirty: '3way',
        worktreePrepare: undefined,
        streamOutput: false,
        outputFormat: 'text',
        gui: true,
        file: undefined,
        selection: undefined,
      }),
      help: () => {},
    };

    await handleRunCommand({}, command).catch(() => {});
    expect(hoisted.startGuiCalled).not.toHaveBeenCalled();
    expect(hoisted.standardReporterCtor).toHaveBeenCalledTimes(1);
  });
});
