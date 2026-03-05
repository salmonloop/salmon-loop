import { describe, expect, test } from 'bun:test';

import { createA2AHttpServer } from '../../../../../src/core/protocols/a2a/server/http-server.js';

describe('A2A HTTP server facade', () => {
  test('delegates fetch requests to routes', async () => {
    const server = createA2AHttpServer({
      routes: {
        handle: async () => Response.json({ ok: true }),
      },
    });

    const response = await server.fetch(
      new Request('https://example.com/a2a/jsonrpc', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
