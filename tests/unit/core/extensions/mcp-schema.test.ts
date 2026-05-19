import { describe, expect, it } from 'bun:test';

import { McpConfigSchema } from '../../../../src/core/extensions/schemas.js';

describe('McpConfigSchema', () => {
  it('accepts stdio server entries', () => {
    const parsed = McpConfigSchema.parse({
      version: 1,
      servers: {
        local: {
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: { NODE_ENV: 'test' },
          cwd: '.',
          allow: { tools: ['*'] },
        },
      },
    });
    expect(parsed.servers.local.command).toBe('node');
  });

  it('accepts http server entries', () => {
    const parsed = McpConfigSchema.parse({
      version: 1,
      servers: {
        remote: {
          enabled: true,
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
          allow: { tools: ['*'] },
        },
      },
    });
    expect(parsed.servers.remote.url).toBe('https://example.com/mcp');
  });

  it('rejects entries with both command and url', () => {
    expect(() =>
      McpConfigSchema.parse({
        version: 1,
        servers: {
          bad: {
            command: 'node',
            url: 'https://example.com/mcp',
            allow: { tools: ['*'] },
          },
        },
      }),
    ).toThrow();
  });

  it('rejects entries with neither command nor url', () => {
    expect(() =>
      McpConfigSchema.parse({
        version: 1,
        servers: {
          bad: {
            allow: { tools: ['*'] },
          },
        },
      }),
    ).toThrow();
  });

  it('rejects stdio-only fields on http entries', () => {
    for (const field of ['args', 'cwd', 'env'] as const) {
      expect(() =>
        McpConfigSchema.parse({
          version: 1,
          servers: {
            bad: {
              url: 'https://example.com/mcp',
              [field]:
                field === 'args' ? ['server.js'] : field === 'cwd' ? '.' : { NODE_ENV: 'test' },
              allow: { tools: ['*'] },
            },
          },
        }),
      ).toThrow();
    }
  });
});
