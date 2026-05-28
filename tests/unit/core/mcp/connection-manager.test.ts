import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, mock } from 'bun:test';

import type { ResolvedMcpServerV2 } from '../../../../src/core/mcp/types.js';

const connectMock = mock(async (transport: any) => {
  await transport.start?.();
});
const closeMock = mock(async () => {});
const callToolMock = mock(async (): Promise<any> => ({ content: [{ type: 'text', text: 'ok' }] }));
const readResourceMock = mock(
  async (): Promise<any> => ({
    contents: [{ uri: 'file:///a', text: 'hello' }],
  }),
);
const subscribeResourceMock = mock(async (): Promise<any> => ({}));
const unsubscribeResourceMock = mock(async (): Promise<any> => ({}));
const getPromptMock = mock(
  async (): Promise<any> => ({
    messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
  }),
);
const listToolsMock = mock(async (): Promise<any> => ({ tools: [] }));
const listResourcesMock = mock(async (): Promise<any> => ({ resources: [] }));
const listResourceTemplatesMock = mock(async (): Promise<any> => ({ resourceTemplates: [] }));
const listPromptsMock = mock(async (): Promise<any> => ({ prompts: [] }));
const getServerCapabilitiesMock = mock(() => ({
  tools: { listChanged: true },
  resources: { listChanged: true },
  prompts: { listChanged: true },
}));
const getServerVersionMock = mock(() => ({ name: 'fake', version: '1.0.0' }));
const setNotificationHandlerMock = mock((schema: any, handler: (notification?: any) => void) => {
  const method = schema?._zod?.def?.shape?.method?.value ?? schema?._def?.shape?.method?.value;
  if (typeof method === 'string') notificationHandlers.set(method, handler);
});
const notificationHandlers = new Map<string, (notification?: any) => void>();
const clientInstances: any[] = [];

class FakeClient {
  onerror?: (error: Error) => void;
  onclose?: () => void;
  fallbackNotificationHandler?: (notification: { method: string }) => Promise<void>;
  transport?: any;

  connect = connectMock;
  close = closeMock;
  callTool = callToolMock;
  readResource = readResourceMock;
  subscribeResource = subscribeResourceMock;
  unsubscribeResource = unsubscribeResourceMock;
  getPrompt = getPromptMock;
  listTools = listToolsMock;
  listResources = listResourcesMock;
  listResourceTemplates = listResourceTemplatesMock;
  listPrompts = listPromptsMock;
  getServerCapabilities = getServerCapabilitiesMock;
  getServerVersion = getServerVersionMock;
  setNotificationHandler = setNotificationHandlerMock;

  constructor() {
    clientInstances.push(this);
  }
}

const httpTransportTerminateMock = mock(async () => {});
const httpTransportMock = mock((url: URL, options: any) => ({
  url,
  options,
  terminateSession: httpTransportTerminateMock,
  close: mock(async () => {}),
  start: mock(async () => {}),
  send: mock(async () => {}),
}));

const spawnInteractiveProcessMock = mock((_input: any) => {
  const stdin = new PassThrough() as PassThrough & {
    end: () => void;
  };
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const child: any = {
    pid: 123,
    stdin,
    stdout,
    stderr,
    exitCode: null,
    once(event: string, handler: (...args: any[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return child;
    },
    on(event: string, handler: (...args: any[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      return child;
    },
    off(event: string, handler: (...args: any[]) => void) {
      listeners.set(
        event,
        (listeners.get(event) ?? []).filter((entry) => entry !== handler),
      );
      return child;
    },
    kill: mock(() => {
      child.exitCode = 0;
      for (const handler of listeners.get('close') ?? []) handler(0);
      return true;
    }),
  };
  queueMicrotask(() => {
    for (const handler of listeners.get('spawn') ?? []) handler();
  });
  return child;
});

mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: FakeClient,
}));

mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: httpTransportMock,
}));

mock.module('../../../../src/core/runtime/process-runner.js', () => ({
  spawnInteractiveProcess: spawnInteractiveProcessMock,
}));

function stdioServer(overrides: Partial<ResolvedMcpServerV2> = {}): ResolvedMcpServerV2 {
  return {
    name: 'local',
    enabled: true,
    transport: {
      type: 'stdio',
      command: 'mcp-server',
      args: ['--stdio'],
      env: { MCP_TOKEN: 'secret' },
    },
    auth: { type: 'none', scopes: [] },
    trust: 'local',
    capabilities: {
      tools: {
        exposeToModel: true,
        allow: ['*'],
        phases: [],
        approval: 'ask',
      },
      resources: {
        allowUris: ['*'],
        autoInclude: false,
        subscribe: false,
        maxBytes: 64_000,
        ttlMs: 30_000,
      },
      prompts: {
        exposeAs: 'none',
        allow: [],
      },
      roots: { mode: 'none' },
      sampling: { enabled: false, maxTokens: 0, maxDepth: 0 },
      elicitation: { enabled: false },
    },
    scope: 'repo',
    ...overrides,
  };
}

async function importManager() {
  return await import('../../../../src/core/mcp/client/connection-manager.js');
}

describe('McpConnectionManager', () => {
  afterEach(() => {
    connectMock.mockReset();
    connectMock.mockImplementation(async (transport: any) => {
      await transport.start?.();
    });
    closeMock.mockReset();
    closeMock.mockImplementation(async () => {});
    callToolMock.mockReset();
    callToolMock.mockImplementation(async () => ({ content: [{ type: 'text', text: 'ok' }] }));
    readResourceMock.mockReset();
    readResourceMock.mockImplementation(async () => ({
      contents: [{ uri: 'file:///a', text: 'hello' }],
    }));
    subscribeResourceMock.mockReset();
    subscribeResourceMock.mockImplementation(async () => ({}));
    unsubscribeResourceMock.mockReset();
    unsubscribeResourceMock.mockImplementation(async () => ({}));
    getPromptMock.mockReset();
    getPromptMock.mockImplementation(async () => ({
      messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
    }));
    listToolsMock.mockReset();
    listToolsMock.mockImplementation(async () => ({ tools: [] }));
    listResourcesMock.mockReset();
    listResourcesMock.mockImplementation(async () => ({ resources: [] }));
    listResourceTemplatesMock.mockReset();
    listResourceTemplatesMock.mockImplementation(async () => ({ resourceTemplates: [] }));
    listPromptsMock.mockReset();
    listPromptsMock.mockImplementation(async () => ({ prompts: [] }));
    getServerCapabilitiesMock.mockReset();
    getServerCapabilitiesMock.mockImplementation(() => ({
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
    }));
    setNotificationHandlerMock.mockClear();
    httpTransportMock.mockClear();
    httpTransportTerminateMock.mockClear();
    spawnInteractiveProcessMock.mockClear();
    notificationHandlers.clear();
    clientInstances.length = 0;
  });

  it('starts stdio with only server.env and discovers a catalog snapshot once', async () => {
    process.env.MCP_SHOULD_NOT_LEAK = 'leak';
    const { McpConnectionManager } = await importManager();
    listToolsMock.mockImplementationOnce(async () => ({
      tools: [{ name: 'read', inputSchema: { type: 'object' } }],
    }));
    listResourcesMock.mockImplementationOnce(async () => ({
      resources: [{ uri: 'file:///a', name: 'A' }],
    }));
    listResourceTemplatesMock.mockImplementationOnce(async () => ({
      resourceTemplates: [{ uriTemplate: 'file:///{path}', name: 'File' }],
    }));
    listPromptsMock.mockImplementationOnce(async () => ({
      prompts: [{ name: 'summarize' }],
    }));
    const manager = new McpConnectionManager([stdioServer()]);

    await manager.startAll();

    expect(spawnInteractiveProcessMock).toHaveBeenCalledTimes(1);
    const [input] = spawnInteractiveProcessMock.mock.calls[0] as any[];
    expect(input).toMatchObject({
      command: 'mcp-server',
      args: ['--stdio'],
      env: { MCP_TOKEN: 'secret' },
      windowsHide: true,
    });
    expect(input.env.MCP_SHOULD_NOT_LEAK).toBeUndefined();
    expect(listToolsMock).toHaveBeenCalledTimes(1);
    expect(manager.getCatalog('local')).toMatchObject({
      serverName: 'local',
      stale: false,
      tools: [{ name: 'read', serverName: 'local' }],
      resources: [{ uri: 'file:///a', serverName: 'local' }],
      resourceTemplates: [{ uriTemplate: 'file:///{path}', serverName: 'local' }],
      prompts: [{ name: 'summarize', serverName: 'local' }],
    });

    await manager.callTool('local', 'read', { path: 'README.md' });
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(callToolMock).toHaveBeenCalledWith(
      { name: 'read', arguments: { path: 'README.md' } },
      expect.anything(),
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('marks catalog stale on list_changed notifications and refresh clears it', async () => {
    const { McpConnectionManager } = await importManager();
    const manager = new McpConnectionManager([stdioServer()]);

    await manager.startAll();
    await notificationHandlers.get('notifications/tools/list_changed')?.();

    expect(manager.getCatalog('local')?.stale).toBe(true);
    await manager.refreshCatalog('local');
    expect(manager.getCatalog('local')?.stale).toBe(false);
  });

  it('subscribes to resource updates on read when resource subscriptions are enabled', async () => {
    const { McpConnectionManager } = await importManager();
    const base = stdioServer();
    getServerCapabilitiesMock.mockImplementation(() => ({
      tools: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
      prompts: { listChanged: true },
    }));
    const manager = new McpConnectionManager([
      {
        ...base,
        capabilities: {
          ...base.capabilities,
          resources: {
            ...base.capabilities.resources,
            subscribe: true,
          },
        },
      },
    ]);

    await manager.startAll();
    await manager.readResource('local', 'file:///a');
    await manager.readResource('local', 'file:///a');

    expect(subscribeResourceMock).toHaveBeenCalledTimes(1);
    expect(subscribeResourceMock).toHaveBeenCalledWith(
      { uri: 'file:///a' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('unsubscribes from resource updates on stop when resource subscriptions were registered', async () => {
    const { McpConnectionManager } = await importManager();
    const base = stdioServer();
    getServerCapabilitiesMock.mockImplementation(() => ({
      tools: { listChanged: true },
      resources: { listChanged: true, subscribe: true },
      prompts: { listChanged: true },
    }));
    const manager = new McpConnectionManager([
      {
        ...base,
        capabilities: {
          ...base.capabilities,
          resources: {
            ...base.capabilities.resources,
            subscribe: true,
          },
        },
      },
    ]);

    await manager.startAll();
    await manager.readResource('local', 'file:///a');
    await manager.stopAll();

    expect(unsubscribeResourceMock).toHaveBeenCalledTimes(1);
    expect(unsubscribeResourceMock).toHaveBeenCalledWith(
      { uri: 'file:///a' },
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('emits resource-updated events without marking the catalog stale', async () => {
    const { McpConnectionManager } = await importManager();
    const manager = new McpConnectionManager([stdioServer()]);
    const updates: Array<{ serverName: string; uri: string }> = [];

    manager.onResourceUpdated((event) => {
      updates.push(event);
    });

    await manager.startAll();
    await notificationHandlers.get('notifications/resources/updated')?.({
      method: 'notifications/resources/updated',
      params: { uri: 'file:///a' },
    });

    expect(updates).toEqual([{ serverName: 'local', uri: 'file:///a' }]);
    expect(manager.getCatalog('local')?.stale).toBe(false);
  });

  it('enters degraded when the server closes and stops gracefully', async () => {
    const { McpConnectionManager } = await importManager();
    const manager = new McpConnectionManager([stdioServer()]);

    await manager.startAll();
    clientInstances[0].onclose();

    expect(manager.views()).toEqual([
      expect.objectContaining({
        serverName: 'local',
        status: 'degraded',
        error: 'MCP server local connection closed',
      }),
    ]);

    await manager.stopAll();
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(manager.views()).toEqual([]);
  });

  it('terminates HTTP sessions on stop', async () => {
    const { McpConnectionManager } = await importManager();
    const manager = new McpConnectionManager([
      stdioServer({
        name: 'remote',
        transport: {
          type: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
        },
      }),
    ]);
    connectMock.mockImplementation(async (transport: any) => {
      clientInstances[0].transport = transport;
    });

    await manager.startAll();
    await manager.stop('remote');

    expect(httpTransportMock).toHaveBeenCalledTimes(1);
    const [url, options] = httpTransportMock.mock.calls[0] as [URL, any];
    expect(url.toString()).toBe('https://example.com/mcp');
    expect(options.requestInit.headers).toEqual({ Authorization: 'Bearer token' });
    expect(httpTransportTerminateMock).toHaveBeenCalledTimes(1);
  });
});
