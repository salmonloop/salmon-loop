import { describe, expect, test } from 'bun:test';

import { createA2AHttpTransport } from '../../../../../../src/core/protocols/a2a/client/http-transport.js';

function buildSseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

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

  test('reconnects SSE streams with last event id using per-call options', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      new Response(
        buildSseStream([
          'id: 1\n',
          'event: task.completed\n',
          'data: {"taskId":"task_1","type":"task.completed"}\n\n',
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
      new Response(
        buildSseStream([
          'id: 2\n',
          'event: task.failed\n',
          'data: {"taskId":"task_1","type":"task.failed"}\n\n',
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    ];

    const transport = createA2AHttpTransport({
      baseUrl: 'https://example.com',
      delayMs: async () => undefined,
      fetch: async (url, init) => {
        seen.push({ url: String(url), init });
        return responses.shift() ?? new Response('', { status: 500 });
      },
    });

    const response = await transport.subscribe('task_1', {
      reconnect: { maxRetries: 1, baseDelayMs: 0 },
    });
    const body = await readAll(response.body!);

    expect(body).toContain('id: 1');
    expect(body).toContain('event: task.completed');
    expect(body).toContain('id: 2');
    expect(body).toContain('event: task.failed');
    expect(seen).toHaveLength(2);
    expect(seen[1]?.init?.headers).toMatchObject({ 'Last-Event-ID': '1' });
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
