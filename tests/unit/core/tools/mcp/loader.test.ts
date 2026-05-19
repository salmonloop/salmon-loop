import { afterEach, describe, expect, it, mock } from 'bun:test';

import type { ResolvedMcpServer } from '../../../../../src/core/extensions/types.js';
import { clearLogger, setLogger } from '../../../../../src/core/observability/logger.js';
import { Phase } from '../../../../../src/core/types/runtime.js';

const startMock = mock(async () => {});
const stopMock = mock(async () => {});
const toolList = [
  {
    name: 'read',
    description: 'Read data',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'git_status',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'bad.name',
    inputSchema: { type: 'object', properties: {} },
  },
];
const listToolsMock = mock(async () => toolList);
const callToolMock = mock(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
const constructorCalls: any[][] = [];

class FakeMcpClient {
  constructor(config: any) {
    constructorCalls.push([config]);
  }

  start = startMock;
  stop = stopMock;
  listTools = listToolsMock;
  callTool = callToolMock;
}

mock.module('../../../../../src/core/tools/mcp/client.js', () => ({
  McpClient: FakeMcpClient,
}));
mock.module('/home/ubuntu/Projects/salmon-loop/src/core/tools/mcp/client.js', () => ({
  McpClient: FakeMcpClient,
}));

function stdioServer(overrides: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return {
    name: 'local',
    enabled: true,
    transport: 'stdio',
    command: 'mcp-server',
    args: [],
    env: {},
    allowTools: ['*'],
    allowResources: [],
    scope: 'repo',
    ...overrides,
  } as ResolvedMcpServer;
}

async function importLoader() {
  return await import('../../../../../src/core/tools/mcp/loader.js');
}

describe('registerMcpTools', () => {
  afterEach(() => {
    clearLogger();
    startMock.mockReset();
    startMock.mockImplementation(async () => {});
    stopMock.mockReset();
    stopMock.mockImplementation(async () => {});
    listToolsMock.mockReset();
    listToolsMock.mockImplementation(async () => toolList);
    callToolMock.mockReset();
    callToolMock.mockImplementation(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    constructorCalls.length = 0;
  });

  it('skips servers without allowlist before connecting', async () => {
    setLogger({ info: mock(), warn: mock(), error: mock(), success: mock(), debug: mock() } as any);
    const { ToolRegistry } = await import('../../../../../src/core/tools/registry.js');
    const { registerMcpTools } = await importLoader();
    const registry = new ToolRegistry();

    await registerMcpTools(registry, [stdioServer({ allowTools: [] })]);

    expect(registry.listAll()).toEqual([]);
    expect(constructorCalls).toHaveLength(0);
    expect(startMock).toHaveBeenCalledTimes(0);
  });

  it('registers allowlisted tools with SalmonLoop governance metadata', async () => {
    setLogger({ info: mock(), warn: mock(), error: mock(), success: mock(), debug: mock() } as any);
    const { ToolRegistry } = await import('../../../../../src/core/tools/registry.js');
    const { registerMcpTools } = await importLoader();
    const registry = new ToolRegistry();

    await registerMcpTools(registry, [stdioServer({ allowTools: ['read', 'git_*'] })]);

    expect(constructorCalls).toHaveLength(1);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(listToolsMock).toHaveBeenCalledTimes(1);
    expect(await listToolsMock.mock.results[0]?.value).toHaveLength(3);
    const specs = registry.listAll();
    expect(specs.map((spec) => spec.name)).toEqual(['mcp.local.read', 'mcp.local.git_status']);
    const readSpec = registry.getSpec('mcp.local.read')!;
    expect(readSpec.source).toBe('mcp');
    expect(readSpec.intent).toBe('INFRA');
    expect(readSpec.riskLevel).toBe('medium');
    expect(readSpec.sideEffects).toEqual(['process', 'network']);
    expect(readSpec.concurrency).toBe('serial_only');
    expect(readSpec.allowedPhases).toEqual([Phase.VERIFY]);
    expect(readSpec.description).toBe('Read data');
    expect(registry.getSpec('mcp.local.git_status')?.description).toBe('MCP tool git_status');
    expect(readSpec.inputSchema.parse({ path: 'README.md' })).toEqual({ path: 'README.md' });
    expect(() => readSpec.inputSchema.parse({})).toThrow();
    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it('executor calls the underlying MCP tool and stops the runtime client', async () => {
    setLogger({ info: mock(), warn: mock(), error: mock(), success: mock(), debug: mock() } as any);
    const { ToolRegistry } = await import('../../../../../src/core/tools/registry.js');
    const { registerMcpTools } = await importLoader();
    const registry = new ToolRegistry();

    await registerMcpTools(registry, [stdioServer({ allowTools: ['read'] })]);
    const result = await registry
      .getSpec('mcp.local.read')!
      .executor({ path: 'README.md' }, {} as any);

    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(callToolMock).toHaveBeenCalledWith('read', { path: 'README.md' });
    expect(stopMock).toHaveBeenCalledTimes(2);
  });

  it('continues registering later servers when one server fails', async () => {
    setLogger({ info: mock(), warn: mock(), error: mock(), success: mock(), debug: mock() } as any);
    startMock.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const { ToolRegistry } = await import('../../../../../src/core/tools/registry.js');
    const { registerMcpTools } = await importLoader();
    const registry = new ToolRegistry();

    await registerMcpTools(registry, [
      stdioServer({ name: 'broken' }),
      stdioServer({ name: 'healthy', allowTools: ['read'] }),
    ]);

    expect(registry.getSpec('mcp.healthy.read')).toBeTruthy();
  });

  it('rejects invalid server and tool names before model-visible registration', async () => {
    setLogger({ info: mock(), warn: mock(), error: mock(), success: mock(), debug: mock() } as any);
    const { ToolRegistry } = await import('../../../../../src/core/tools/registry.js');
    const { registerMcpTools } = await importLoader();
    const registry = new ToolRegistry();

    await registerMcpTools(registry, [stdioServer({ name: 'bad.server' })]);
    expect(registry.listAll()).toEqual([]);
    expect(constructorCalls).toHaveLength(0);

    await registerMcpTools(registry, [stdioServer({ allowTools: ['*'] })]);
    expect(registry.getSpec('mcp.local.bad.name')).toBeUndefined();
  });
});
