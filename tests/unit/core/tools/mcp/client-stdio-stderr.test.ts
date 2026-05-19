import { PassThrough } from 'stream';

import { afterEach, describe, expect, it, mock } from 'bun:test';

import { LIMITS } from '../../../../../src/core/config/limits.js';
import { clearLogger, setLogger } from '../../../../../src/core/observability/logger.js';

const stderrStream = new PassThrough();
const transportCloseMock = mock(async () => {});
const transportTerminateMock = mock(async () => {});
const stdioTransportMock = mock((params: any) => {
  return {
    params,
    stderr: stderrStream,
    close: transportCloseMock,
  };
});
const httpTransportMock = mock((url: URL, options: any) => {
  return {
    url,
    options,
    close: transportCloseMock,
    terminateSession: transportTerminateMock,
  };
});
const connectMock = mock(async () => {});
const closeMock = mock(async () => {});
const listToolsMock = mock(async () => ({ tools: [] }));
const callToolMock = mock(async () => ({ content: [{ type: 'text', text: 'ok' }] }));

mock.module('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: stdioTransportMock,
}));

mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: httpTransportMock,
}));

mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: mock(() => {
    return {
      connect: connectMock,
      close: closeMock,
      listTools: listToolsMock,
      callTool: callToolMock,
    };
  }),
}));

describe('McpClient (official SDK adapter)', () => {
  afterEach(() => {
    clearLogger();
    connectMock.mockClear();
    closeMock.mockClear();
    listToolsMock.mockClear();
    callToolMock.mockClear();
    transportCloseMock.mockClear();
    transportTerminateMock.mockClear();
    stdioTransportMock.mockClear();
    httpTransportMock.mockClear();
  });

  it('uses official stdio transport with private stderr and SalmonLoop timeout', async () => {
    setLogger({ info: mock(), warn: mock(), error: mock(), success: mock(), debug: mock() } as any);
    const dataListenerCount = stderrStream.listenerCount('data');
    const { McpClient } = await import('../../../../../src/core/tools/mcp/client.js');
    const client = new McpClient({
      name: 'test',
      command: 'node',
      args: ['server.js'],
      env: { MCP_TOKEN: 'secret' },
      cwd: '/repo',
    });

    await client.start();
    await client.listTools();
    await client.callTool('echo', { value: 'hi' });
    await client.stop();

    expect(stdioTransportMock).toHaveBeenCalledTimes(1);
    const params = stdioTransportMock.mock.calls[0]?.[0] as any;
    expect(params.command).toBe('node');
    expect(params.args).toEqual(['server.js']);
    expect(params.env.MCP_TOKEN).toBe('secret');
    expect(params.cwd).toBe('/repo');
    expect(params.stderr).toBe('pipe');
    expect(stderrStream.listenerCount('data')).toBe(dataListenerCount + 1);
    expect((connectMock.mock.calls as any)[0]?.[1]).toEqual({
      timeout: LIMITS.defaultToolTimeoutMs,
    });
    expect((listToolsMock.mock.calls as any)[0]?.[1]).toEqual({
      timeout: LIMITS.defaultToolTimeoutMs,
    });
    expect((callToolMock.mock.calls as any)[0]?.[0]).toEqual({
      name: 'echo',
      arguments: { value: 'hi' },
    });
    expect((callToolMock.mock.calls as any)[0]?.[2]).toEqual({
      timeout: LIMITS.defaultToolTimeoutMs,
    });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('uses official Streamable HTTP transport with configured headers', async () => {
    setLogger({ info: mock(), warn: mock(), error: mock(), success: mock(), debug: mock() } as any);
    const { McpClient } = await import('../../../../../src/core/tools/mcp/client.js');
    const client = new McpClient({
      name: 'remote',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    });

    await client.start();
    await client.stop();

    expect(httpTransportMock).toHaveBeenCalledTimes(1);
    const [url, options] = httpTransportMock.mock.calls[0] as [URL, any];
    expect(url.toString()).toBe('https://example.com/mcp');
    expect(options.requestInit.headers).toEqual({ Authorization: 'Bearer token' });
    expect(transportTerminateMock).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
