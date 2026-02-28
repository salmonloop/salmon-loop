import { describe, expect, test } from 'bun:test';

import { createA2AHttpTransport } from '../../../../../../src/core/protocols/a2a/client/http-transport.js';

describe('A2A http transport', () => {
  test('posts JSON-RPC requests with headers', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];

    const transport = createA2AHttpTransport({
      baseUrl: 'https://example.com',
      headers: { authorization: 'Bearer token' },
      fetch: async (url, init) => {
        seen.push({ url: String(url), init });
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', result: { id: 'task_1' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const response = await transport.request({
      jsonrpc: '2.0',
      id: '1',
      method: 'tasks/get',
      params: { id: 'task_1' },
    });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: '1',
      result: { id: 'task_1' },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://example.com/rpc');
    expect(seen[0]?.init?.method).toBe('POST');
    expect(seen[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer token',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });

  test('subscribes to SSE with Last-Event-ID header', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];

    const transport = createA2AHttpTransport({
      baseUrl: 'https://example.com',
      fetch: async (url, init) => {
        seen.push({ url: String(url), init });
        return new Response('event: ping\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });

    const response = await transport.subscribe('task_1', { lastEventId: '42' });

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://example.com/tasks/task_1/subscribe');
    expect(seen[0]?.init?.method).toBe('GET');
    expect(seen[0]?.init?.headers).toMatchObject({
      Accept: 'text/event-stream',
      'Last-Event-ID': '42',
    });
  });

  test('throws on non-ok rpc responses', async () => {
    const transport = createA2AHttpTransport({
      baseUrl: 'https://example.com',
      fetch: async () => new Response('bad', { status: 500 }),
    });

    await expect(
      transport.request({ jsonrpc: '2.0', id: '1', method: 'tasks/get', params: { id: 'x' } }),
    ).rejects.toThrow('A2A RPC request failed');
  });
});
