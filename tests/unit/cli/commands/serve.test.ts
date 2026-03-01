import { describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  listenCalls: [] as Array<{
    options: { port?: number; host?: string; path?: string };
  }>,
  acpLoopCalls: [] as Array<Record<string, unknown>>,
}))();

mock.module('../../../../src/core/runtime/sidecar-paths.js', () => ({
  getSidecarSocketPath: () => '/tmp/agent-message.sock',
}));

mock.module('../../../../src/core/config/resolve.js', () => ({
  resolveConfig: mock(async () => ({
    llm: {},
    llmOutput: { kinds: [] },
    observability: { langfuse: { enabled: false } },
    toolAuthorization: { allowlist: {} },
    verify: { command: undefined },
    cli: { defaults: {} },
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

mock.module('../../../../src/core/adapters/fs/node-fs.js', () => ({
  mkdir: mock(async () => {}),
}));

mock.module('../../../../src/cli/commands/run/runtime-llm.js', () => ({
  createRuntimeLlmAndWarn: mock(() => ({ llm: {}, warnings: [] })),
}));

mock.module('../../../../src/core/runtime/loop.js', () => ({
  runSalmonLoop: mock(async () => ({ success: true })),
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
});
