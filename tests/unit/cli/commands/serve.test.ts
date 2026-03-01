import { describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  listenCalls: [] as Array<{
    options: { port?: number; host?: string; path?: string };
  }>,
  acpLoopCalls: [] as Array<Record<string, unknown>>,
  lastRunLoopOptions: undefined as Record<string, unknown> | undefined,
  runLoop: undefined as
    | ((options: { instruction: string; mode: string }) => Promise<unknown>)
    | undefined,
  config: {
    llm: { api: { baseUrl: undefined, apiKey: undefined } },
    llmOutput: { kinds: [] },
    observability: { langfuse: { enabled: false, outcome: false }, audit: { scope: 'repo' } },
    toolAuthorization: { allowlist: {} },
    verify: { command: undefined },
    cli: { defaults: {} },
  } as any,
}))();

mock.module('../../../../src/core/runtime/sidecar-paths.js', () => ({
  getSidecarSocketPath: () => '/tmp/agent-message.sock',
}));

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
}));

mock.module('../../../../src/core/adapters/fs/node-fs.js', () => ({
  mkdir: mock(async () => {}),
}));

mock.module('../../../../src/cli/commands/run/runtime-llm.js', () => ({
  createRuntimeLlmAndWarn: mock(() => ({ llm: {}, warnings: [] })),
}));

mock.module('../../../../src/core/runtime/loop.js', () => ({
  runSalmonLoop: mock(async (options: Record<string, unknown>) => {
    hoisted.lastRunLoopOptions = options;
    return { success: true };
  }),
}));

mock.module('../../../../src/core/backends/salmon-loop/task-executor.js', () => ({
  createSalmonTaskExecutor: mock((deps: { runLoop: any }) => {
    hoisted.runLoop = deps.runLoop;
    return {
      execute: mock(async () => ({
        id: 'task_1',
        state: 'completed',
        request: { instruction: '' },
      })),
    };
  }),
}));

mock.module('../../../../src/cli/utils/outcome-reporter.js', () => ({
  createOutcomeReporter: mock(() => ({ type: 'outcome-reporter' })),
}));

mock.module('../../../../src/core/protocols/acp/index.js', () => ({
  createAcpJsonRpcHandler: mock(() => ({ handle: mock(async () => null) })),
}));

mock.module('../../../../src/core/transports/stdio/acp-stdio-loop.js', () => ({
  createAcpStdioLoop: mock((args: Record<string, unknown>) => {
    hoisted.acpLoopCalls.push(args);
    return { close: () => {} };
  }),
}));

mock.module('../../../../src/cli/authorization/provider.js', () => ({
  createTerminalAuthorizationProvider: mock(() => ({ type: 'terminal' })),
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

describe('handleServeCommand', () => {
  it('builds runtime with listen options and starts', async () => {
    const { handleServeCommand } = await import('../../../../src/cli/commands/serve.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: '/repo',
        a2aHost: '0.0.0.0',
        a2aPort: '8081',
        acpStdio: false,
        sidecarSocket: '/tmp/custom.sock',
        sidecarAllowConditional: true,
      }),
    };

    await handleServeCommand({}, command);

    expect(hoisted.listenCalls).toEqual([
      { options: { host: '0.0.0.0', port: 8081 } },
      { options: { path: '/tmp/custom.sock' } },
    ]);
  });

  it('starts ACP stdio loop when enabled', async () => {
    const { handleServeCommand } = await import('../../../../src/cli/commands/serve.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: '/repo',
        a2aHost: '127.0.0.1',
        a2aPort: '8081',
        acpStdio: true,
      }),
    };

    await handleServeCommand({}, command);

    expect(hoisted.acpLoopCalls.length).toBe(1);
  });

  it('passes outcome reporter and langfuse ids to the loop', async () => {
    hoisted.config = {
      llm: { api: { baseUrl: 'https://llm.example.test', apiKey: 'llm-key' } },
      llmOutput: { kinds: [] },
      observability: {
        langfuse: {
          enabled: true,
          outcome: true,
          endpoint: 'https://langfuse.example.test',
          sessionId: 'session-123',
          userId: 'user-456',
        },
        audit: { scope: 'repo' },
      },
      toolAuthorization: { allowlist: {} },
      verify: { command: undefined },
      cli: { defaults: {} },
    };

    const { handleServeCommand } = await import('../../../../src/cli/commands/serve.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: '/repo',
        a2aHost: '127.0.0.1',
        a2aPort: '8081',
        acpStdio: false,
      }),
    };

    await handleServeCommand({}, command);

    expect(hoisted.runLoop).toBeDefined();
    await hoisted.runLoop!({ instruction: 'test', mode: 'patch' });

    expect(hoisted.lastRunLoopOptions).toBeDefined();
    expect(hoisted.lastRunLoopOptions?.outcomeReporter).toEqual({ type: 'outcome-reporter' });
    expect(hoisted.lastRunLoopOptions?.langfuseSessionId).toBe('session-123');
    expect(hoisted.lastRunLoopOptions?.langfuseUserId).toBe('user-456');
  });

  it('passes audit scope override to the loop', async () => {
    const { handleServeCommand } = await import('../../../../src/cli/commands/serve.js');

    const command: any = {
      optsWithGlobals: () => ({
        repo: '/repo',
        a2aHost: '127.0.0.1',
        a2aPort: '8081',
        acpStdio: false,
        auditScope: 'user',
      }),
    };

    await handleServeCommand({}, command);

    expect(hoisted.runLoop).toBeDefined();
    await hoisted.runLoop!({ instruction: 'test', mode: 'patch' });

    expect(hoisted.lastRunLoopOptions?.auditScope).toBe('user');
  });
});
