import { describe, expect, it, mock } from 'bun:test';
import { Command } from 'commander';

const hoisted = (() => ({
  listenCalls: [] as Array<{ options: { port?: number; host?: string; path?: string } }>,
  acpLoopCalls: [] as Array<Record<string, unknown>>,
  agentServerRuntimeCalls: 0,
  config: {
    llm: { api: { baseUrl: undefined, apiKey: undefined } },
    llmOutput: { kinds: [] },
    observability: { langfuse: { enabled: false, outcome: false }, audit: { scope: 'repo' } },
    toolAuthorization: { allowlist: {} },
    verify: { command: undefined },
    cli: { defaults: {} },
  } as any,
}))();

mock.module('../../../../src/core/config/resolve.js', () => ({
  resolveConfig: mock(async () => hoisted.config),
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

mock.module('../../../../src/core/observability/logger.js', () => ({
  logger: {
    error: mock(),
    warn: mock(),
    info: mock(),
    success: mock(),
    setReporter: mock(),
  },
  StderrReporter: class {},
  PlainReporter: class {},
}));

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

mock.module('../../../../src/cli/utils/outcome-reporter.js', () => ({
  createOutcomeReporter: mock(() => ({ type: 'outcome-reporter' })),
}));

mock.module('../../../../src/core/protocols/acp/formal-agent.js', () => ({
  createAcpFormalAgent: mock(() => ({
    initialize: mock(async () => ({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true },
    })),
    authenticate: mock(async () => ({})),
    newSession: mock(async () => ({ sessionId: 'sess_1' })),
    prompt: mock(async () => ({ stopReason: 'end_turn' })),
    cancel: mock(async () => {}),
  })),
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

describe('handleServeAcpCommand', () => {
  it('starts ACP stdio loop without starting A2A + sidecar listeners', async () => {
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
});

describe('registerServeCommands', () => {
  it('registers `serve acp` subcommand', async () => {
    const { registerServeCommands } = await import('../../../../src/cli/commands/serve.js');

    const program = new Command();
    registerServeCommands(program);

    const serve = program.commands.find((cmd) => cmd.name() === 'serve');
    expect(serve).toBeTruthy();
    expect(serve!.commands.some((cmd) => cmd.name() === 'acp')).toBe(true);
  });
});
