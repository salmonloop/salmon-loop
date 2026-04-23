import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { clearLogger, setLogger } from '../../../../src/core/observability/logger.js';
import { buildPublicCapabilityRegistry } from '../../../../src/core/public-capabilities/registry.js';
import {
  selectPublicCapabilitiesForSurface,
  toA2APublicSkills,
} from '../../../../src/core/public-capabilities/projections.js';

function createDefaultResolvedConfig() {
  return {
    llm: { api: { baseUrl: undefined, apiKey: undefined } },
    llmOutput: { kinds: [] },
    observability: { langfuse: { enabled: false, outcome: false }, audit: { scope: 'repo' } },
    toolAuthorization: { allowlist: {} },
    verify: { command: undefined },
    cli: { defaults: {} },
  } as any;
}

const hoisted = (() => ({
  listenCalls: [] as Array<{
    options: { port?: number; host?: string; path?: string; type?: string };
  }>,
  sidecarRoutes: [] as Array<Array<Record<string, any>>>,
  a2aAgentCards: [] as Array<Record<string, unknown>>,
  acpLoopCalls: [] as Array<Record<string, unknown>>,
  acpAgentConfigs: [] as Array<Record<string, unknown>>,
  lastRunLoopOptions: undefined as Record<string, unknown> | undefined,
  runLoop: undefined as
    | ((options: { instruction: string; mode: string }) => Promise<unknown>)
    | undefined,
  config: createDefaultResolvedConfig(),
  logger: {
    error: mock(),
    warn: mock(),
    info: mock(),
    success: mock(),
    setReporter: mock(),
  },
}))();

mock.module('../../../../src/core/runtime/agent-server-runtime.js', () => ({
  createAgentServerRuntime: mock((config: any) => {
    hoisted.a2aAgentCards.push(config.a2a.buildAgentCard());
    hoisted.sidecarRoutes.push(config.sidecar.routes);
    hoisted.listenCalls.push({ options: config.listen.a2a });
    hoisted.listenCalls.push({ options: config.listen.sidecar });
    return {
      start: mock(async () => {}),
      close: mock(async () => {}),
    };
  }),
}));

mock.module('../../../../src/core/runtime/sidecar-paths.js', () => ({
  getSidecarSocketPath: () => '/tmp/agent-message.sock',
  getSidecarListenOptions: () => ({ type: 'pipe' as const, path: '/tmp/agent-message.sock' }),
  createPipeListenOptions: (path: string) => ({ type: 'pipe' as const, path }),
  createTcpListenOptions: (port: number, host = '127.0.0.1') => ({
    type: 'tcp' as const,
    port,
    host,
  }),
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

mock.module('../../../../src/core/adapters/fs/node-fs.js', () => ({
  mkdir: mock(async () => {}),
  readdir: mock(async () => []),
  rename: mock(async () => {}),
  rm: mock(async () => {}),
  stat: mock(async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  }),
  readFile: mock(async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  }),
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

describe('handleServeCommand', () => {
  afterAll(() => {
    mock.restore();
    clearLogger();
  });

  beforeEach(() => {
    setLogger(hoisted.logger as any);
    hoisted.listenCalls.length = 0;
    hoisted.sidecarRoutes.length = 0;
    hoisted.a2aAgentCards.length = 0;
    hoisted.acpLoopCalls.length = 0;
    hoisted.acpAgentConfigs.length = 0;
    hoisted.lastRunLoopOptions = undefined;
    hoisted.runLoop = undefined;
    hoisted.config = createDefaultResolvedConfig();
    hoisted.logger.error.mockReset();
    hoisted.logger.warn.mockReset();
    hoisted.logger.info.mockReset();
    hoisted.logger.success.mockReset();
    hoisted.logger.setReporter.mockReset();
  });

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
      { options: { type: 'pipe', path: '/tmp/custom.sock' } },
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

  it('exposes only autopilot as the reachable A2A skill in serve runtime', async () => {
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

    expect(hoisted.a2aAgentCards).toHaveLength(1);
    expect(hoisted.a2aAgentCards[0].skills).toEqual([
      {
        id: 'autopilot',
        name: 'Autopilot',
        description: 'Let the agent decide which actions and tools to use.',
        tags: [],
      },
    ]);
  });

  it('projects served A2A skills from the public capability registry', async () => {
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

    const expectedSkills = toA2APublicSkills(
      selectPublicCapabilitiesForSurface('a2a', buildPublicCapabilityRegistry()),
    ).map((skill) => ({
      id: skill.id,
      name: skill.title,
      description: skill.description,
      tags: [],
    }));

    expect(hoisted.a2aAgentCards[0].skills).toEqual(expectedSkills);
  });

  it('keeps sidecar capability metadata on its explicit path', async () => {
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

    const infoRoute = hoisted.sidecarRoutes[0]?.find((route) => route.path === '/info');
    expect(infoRoute).toBeDefined();
    if (!infoRoute) {
      throw new Error('missing sidecar info route');
    }

    const response = await infoRoute.handler();
    const payload = await response.json();

    expect(payload.capabilities).toEqual([{ id: 'autopilot', title: 'Autopilot' }]);
  });

  it('does not advertise unresolved flow-backed A2A skills before runtime selection exists', async () => {
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

    const skillIds = (hoisted.a2aAgentCards[0].skills as Array<{ id: string }>).map(
      (skill) => skill.id,
    );
    expect(skillIds).not.toContain('review');
    expect(skillIds).not.toContain('debug');
    expect(skillIds).not.toContain('research');
    expect(skillIds).not.toContain('answer');
  });

  it('maps legacy yolo server defaults to ACP autopilot mode plus allow_all policy', async () => {
    hoisted.config = {
      ...hoisted.config,
      permissionMode: 'yolo',
    };

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
