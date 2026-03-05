import { describe, expect, test } from 'bun:test';

import { createA2AHttpClient } from '../../../../../../src/core/protocols/a2a/client/http-client.js';

describe('A2A http client factory', () => {
  test('creates client with default http transport', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];

    const client = createA2AHttpClient({
      baseUrl: 'https://example.com',
      fetch: async (url, init) => {
        seen.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            result: {
              id: 'task_1',
              state: 'accepted',
              status: { state: 'submitted', timestamp: '2026-02-28T00:00:00.000Z' },
              metadata: { capability: 'patch' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    const task = await client.startTask({ instruction: 'fix bug' });

    expect(task.id).toBe('task_1');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://example.com/a2a/jsonrpc');
  });

  test('merges default headers with per-call overrides', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];

    const client = createA2AHttpClient({
      baseUrl: 'https://example.com',
      defaultOptions: { headers: { authorization: 'Bearer default', 'x-default': '1' } },
      fetch: async (url, init) => {
        seen.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '2',
            result: {
              id: 'task_2',
              state: 'accepted',
              status: { state: 'submitted', timestamp: '2026-02-28T00:00:00.000Z' },
              metadata: { capability: 'patch' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });

    await client.startTask(
      { instruction: 'fix bug' },
      { headers: { authorization: 'Bearer override', 'x-call': '1' } },
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer override',
      'x-default': '1',
      'x-call': '1',
    });
  });

  test('applies default idle timeout with per-call override', async () => {
    const timeouts: number[] = [];
    const client = createA2AHttpClient({
      baseUrl: 'https://example.com',
      defaultOptions: { idleTimeoutMs: 100 },
      setTimeout: (handler, timeout) => {
        if (typeof timeout === 'number') timeouts.push(timeout);
        handler();
        return 1;
      },
      clearTimeout: () => undefined,
      fetch: async () =>
        new Response(new ReadableStream({ start() {} }), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    });

    await client.subscribeTask('task_1', () => undefined, { autoSyncOnEnd: false });
    await client.subscribeTask('task_2', () => undefined, {
      idleTimeoutMs: 250,
      autoSyncOnEnd: false,
    });

    expect(timeouts).toEqual([100, 250]);
  });
});
