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
    expect(seen[0]?.url).toBe('https://example.com/rpc');
  });
});
