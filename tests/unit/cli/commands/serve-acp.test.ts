import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { Command } from 'commander';

import { clearLogger, setLogger } from '../../../../src/core/observability/logger.js';

const hoisted = (() => ({
  listenCalls: [] as Array<{ options: { port?: number; host?: string; path?: string } }>,
  acpLoopCalls: [] as Array<Record<string, unknown>>,
  acpAgentConfigs: [] as Array<Record<string, unknown>>,
  agentServerRuntimeCalls: 0,
  onceCalls: [] as Array<{ event: string; handler: (...args: any[]) => void }>,
  processExit: mock((_code?: number) => undefined as never),
  config: {
    llm: { api: { baseUrl: undefined, apiKey: undefined } },
    llmOutput: { kinds: [] },
    observability: { langfuse: { enabled: false, outcome: false }, audit: { scope: 'repo' } },
    toolAuthorization: { allowlist: {} },
    verify: { command: undefined },
    cli: { defaults: {} },
  } as any,
  logger: {
    error: mock(),
    warn: mock(),
    info: mock(),
    success: mock(),
    setReporter: mock(),
  },
}))();

mock.module('../../../../src/cli/utils/resolve-cli-config.js', () => ({
  resolveCliConfig: mock(async (options: { auditScope?: string }) => ({
    ok: true,
    resolvedConfig: hoisted.config,
    auditScope: options.auditScope ?? 'repo',
    repoPath: '/repo',
  })),
}));

mock.module('../../../../src/core/extensions/index.js', () => ({
  resolveExtensions: mock(async () => ({
    resolved: {
      mcpServers: [],
      toolPlugins: [],
      skillDiscovery: { useDefaults: true, paths: [], scope: 'repo' },
    },
  })),
}));

mock.module('../../../../src/core/plugin/loader.js', () => ({
  PluginLoader: { loadPlugins: mock(async () => {}) },
}));

// Use setLogger() instead of mocking the entire logger module so imports remain stable.

mock.module('../../../../src/cli/commands/run/runtime-llm.js', () => ({
  createRuntimeLlmAndWarn: mock(() => ({ llm: {}, warnings: [] })),
}));

mock.module('../../../../src/core/runtime/loop.js', () => ({
  runSalmonLoop: mock(async () => ({ success: true })),
}));

mock.module('../../../../src/core/backends/salmon-loop/task-executor.js', () => ({
  createSalmonTaskExecutor: mock(() => ({
    execute: mock(async () => ({
      id: 'task_1',
      state: 'completed',
      request: { instruction: '' },
    })),
  })),
}));

mock.module('../../../../src/core/checkpoint-domain/service.js', () => ({
  GitSnapshotCheckpointService: class {
    async gc() {
      return { removed: 0 };
    }

    async list() {
      return [];
    }

    async loadWithStatus() {
      return { handle: null, reason: 'not_found' as const };
    }
  },
}));

mock.module('../../../../src/cli/utils/outcome-reporter.js', () => ({
  createOutcomeReporter: mock(() => ({ type: 'outcome-reporter' })),
}));

mock.module('../../../../src/core/protocols/acp/formal-agent.js', () => ({
  createAcpFormalAgent: mock((config: Record<string, unknown>) => {
    hoisted.acpAgentConfigs.push(config);
    return {
      initialize: mock(async () => ({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true },
      })),
      authenticate: mock(async () => ({})),
      newSession: mock(async () => ({ sessionId: 'sess_1' })),
      prompt: mock(async () => ({ stopReason: 'end_turn' })),
      cancel: mock(async () => {}),
    };
  }),
}));

mock.module('../../../../src/core/protocols/acp/stdio-server.js', () => ({
  startAcpStdioServer: mock((args: unknown) => {
    hoisted.acpLoopCalls.push({ createAgent: args });
    return { closed: Promise.resolve() };
  }),
}));

mock.module('../../../../src/cli/authorization/provider.js', () => ({
  createTerminalAuthorizationProvider: mock(() => ({ type: 'terminal' })),
}));

mock.module('../../../../src/core/runtime/agent-server-runtime.js', () => ({
  createAgentServerRuntime: mock(() => {
    hoisted.agentServerRuntimeCalls += 1;
    return {
      start: mock(async () => {}),
      close: mock(async () => {}),
    };
  }),
}));

mock.module('fastify', () => ({
  default: () => ({
    route: mock(() => {}),
    register: mock(async (plugin: any) => plugin({ route: mock(() => {}) })),
    listen: mock(async (listenOptions: { port?: number; host?: string; path?: string }) => {
      hoisted.listenCalls.push({ options: listenOptions });
    }),
    close: mock(async () => {}),
  }),
}));

afterAll(() => {
  process.once = originalProcessOnce as typeof process.once;
  process.on = originalProcessOn as typeof process.on;
  process.stdin.destroy = originalStdinDestroy as typeof process.stdin.destroy;
  process.exit = originalProcessExit as typeof process.exit;
  mock.restore();
  clearLogger();
});

const originalProcessOnce = process.once.bind(process);
const originalProcessOn = process.on.bind(process);
const originalStdinDestroy = process.stdin.destroy.bind(process.stdin);
const originalProcessExit = process.exit.bind(process);

beforeEach(() => {
  setLogger(hoisted.logger as any);
  hoisted.acpLoopCalls.length = 0;
  hoisted.acpAgentConfigs.length = 0;
  hoisted.agentServerRuntimeCalls = 0;
  hoisted.onceCalls.length = 0;
  hoisted.processExit.mockReset();
  hoisted.logger.error.mockReset();
  hoisted.logger.warn.mockReset();
  hoisted.logger.info.mockReset();
  hoisted.logger.success.mockReset();
  hoisted.logger.setReporter.mockReset();
  process.once = ((event: string, handler: (...args: any[]) => void) => {
    hoisted.onceCalls.push({ event, handler });
    return process;
  }) as typeof process.once;
  process.on = ((event: string, handler: (...args: any[]) => void) => {
    throw new Error(`Unexpected process.on registration for ${event}`);
  }) as typeof process.on;
  process.stdin.destroy = mock(() => process.stdin) as typeof process.stdin.destroy;
  process.exit = hoisted.processExit as typeof process.exit;
});

describe('handleServeAcpCommand', () => {
  it('starts ACP stdio loop without starting the A2A listener', async () => {
    const { handleServeAcpCommand } = await import('../../../../src/cli/commands/serve.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: '/repo',
        color: false,
      }),
    };

    await handleServeAcpCommand({}, command);

    expect(hoisted.acpLoopCalls.length).toBe(1);
    expect(hoisted.listenCalls.length).toBe(0);
    expect(hoisted.agentServerRuntimeCalls).toBe(0);
  });

  it('maps legacy yolo server defaults to ACP autopilot mode plus allow_all policy', async () => {
    hoisted.config = {
      ...hoisted.config,
      permissionMode: 'yolo',
    };

    const { handleServeAcpCommand } = await import('../../../../src/cli/commands/serve.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: '/repo',
        color: false,
      }),
    };

    await handleServeAcpCommand({}, command);

    const createAgent = hoisted.acpLoopCalls[0]?.createAgent as
      | ((conn: unknown) => unknown)
      | undefined;
    expect(typeof createAgent).toBe('function');
    createAgent?.({});

    expect(hoisted.acpAgentConfigs).toHaveLength(1);
    expect(hoisted.acpAgentConfigs[0]).toMatchObject({
      defaultModeId: 'autopilot',
      defaultPermissionPolicy: 'allow_all',
    });
  });

  it('registers a single SIGINT shutdown handler for ACP stdio', async () => {
    const { handleServeAcpCommand } = await import('../../../../src/cli/commands/serve.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: '/repo',
        color: false,
      }),
    };

    await handleServeAcpCommand({}, command);

    expect(hoisted.onceCalls.filter((call) => call.event === 'SIGINT')).toHaveLength(1);

    await hoisted.onceCalls[0]!.handler();

    expect(process.stdin.destroy).toHaveBeenCalledTimes(1);
    expect(hoisted.processExit).toHaveBeenCalledWith(0);
  });
});

describe('registerServeCommands', () => {
  it('registers `serve acp` subcommand', async () => {
    const { registerServeCommands } = await import('../../../../src/cli/commands/serve.js');

    const program = new Command();
    registerServeCommands(program);

    const serve = program.commands.find((cmd) => cmd.name() === 'serve');
    expect(serve).toBeTruthy();
    expect(serve!.commands.some((cmd) => cmd.name() === 'acp')).toBe(true);
    expect(serve!.options.some((option) => option.long === '--sidecar-socket')).toBe(false);
    expect(serve!.options.some((option) => option.long === '--sidecar-allow-conditional')).toBe(
      false,
    );
  });
});
