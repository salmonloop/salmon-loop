import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  standardReporterCtor: vi.fn(),
}));

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
    llmOutput: { kinds: [] },
    markdownTheme: 'default',
    markdownRenderMode: 'enhanced',
    verify: { command: 'node -e "process.exit(0)"' },
    llm: { type: 'stub', clientPackage: undefined },
    toolAuthorization: { allowlist: {} },
  })),
  redactConfigForPrint: (v: any) => v,
}));

vi.mock('../../../../src/core/extensions/index.js', () => ({
  ExtensionConfigError: class ExtensionConfigError extends Error {},
  resolveExtensions: vi.fn(async () => ({ resolved: [] })),
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
    return runFn(() => {}, undefined, { signal: new AbortController().signal });
  }),
}));
vi.mock('../../../../src/cli/ui/index.tsx', () => ({
  startGUI: vi.fn(async (_mode: any, _sessionManager: any, runFn: any) => {
    return runFn(() => {}, undefined, { signal: new AbortController().signal });
  }),
}));

vi.mock('../../../../src/cli/utils/verify-resolver.js', () => ({
  resolveVerifyOption: vi.fn(async (_repoRoot: string, cliVerify?: string, cfgVerify?: string) => {
    return cliVerify ?? cfgVerify ?? 'node -e "process.exit(0)"';
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
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as any);
  });

  afterEach(() => {
    exitSpy?.mockRestore();
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
        instruction: 'test',
        mode: 'patch',
        configFile: true,
        config: undefined,
        printConfig: false,
        validate: false,
        llmOutput: undefined,
        verify: 'node -e "process.exit(0)"',
        dryRun: true,
        forceReset: false,
        verbose: false,
        checkpointStrategy: 'worktree',
        applyBackOnDirty: '3way',
        worktreePrepare: undefined,
        streamOutput: false,
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
        instruction: 'test',
        mode: 'patch',
        configFile: true,
        config: undefined,
        printConfig: false,
        validate: false,
        llmOutput: undefined,
        verify: 'node -e "process.exit(0)"',
        dryRun: true,
        forceReset: false,
        verbose: false,
        checkpointStrategy: 'worktree',
        applyBackOnDirty: '3way',
        worktreePrepare: undefined,
        streamOutput: false,
        gui: false,
        file: undefined,
        selection: undefined,
      }),
      help: () => {},
    };

    await handleRunCommand({}, command).catch(() => {});
    expect(hoisted.standardReporterCtor).toHaveBeenCalledTimes(1);
  });
});
