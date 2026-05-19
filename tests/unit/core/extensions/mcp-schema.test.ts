import { describe, expect, it } from 'bun:test';

import { McpConfigSchema } from '../../../../src/core/extensions/schemas.js';

describe('McpConfigSchema', () => {
  it('accepts v2 stdio server entries with explicit env', () => {
    const parsed = McpConfigSchema.parse({
      version: 2,
      servers: {
        local: {
          enabled: true,
          transport: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { NODE_ENV: 'test' },
            cwd: '.',
          },
          capabilities: {
            tools: {
              exposeToModel: true,
              allow: ['*'],
            },
          },
        },
      },
    });
    expect(parsed.servers.local.transport).toMatchObject({
      type: 'stdio',
      command: 'node',
    });
  });

  it('accepts v2 http server entries', () => {
    const parsed = McpConfigSchema.parse({
      version: 2,
      servers: {
        remote: {
          enabled: true,
          transport: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer token' },
          },
          capabilities: {
            tools: {
              exposeToModel: true,
              allow: ['*'],
            },
          },
        },
      },
    });
    expect(parsed.servers.remote.transport).toMatchObject({
      type: 'http',
      url: 'https://example.com/mcp',
    });
  });

  it('rejects v1 configs outright', () => {
    expect(() =>
      McpConfigSchema.parse({
        version: 1,
        servers: {
          bad: {
            command: 'node',
            allow: { tools: ['*'] },
          },
        },
      }),
    ).toThrow();
  });

  it('rejects entries with neither stdio nor http transport', () => {
    expect(() =>
      McpConfigSchema.parse({
        version: 2,
        servers: {
          bad: {
            capabilities: {
              tools: {
                exposeToModel: true,
                allow: ['*'],
              },
            },
          },
        },
      }),
    ).toThrow();
  });

  it('rejects stdio-only fields on http entries', () => {
    for (const field of ['args', 'cwd', 'env'] as const) {
      expect(() =>
        McpConfigSchema.parse({
          version: 2,
          servers: {
            bad: {
              transport: {
                type: 'http',
                url: 'https://example.com/mcp',
                [field]:
                  field === 'args' ? ['server.js'] : field === 'cwd' ? '.' : { NODE_ENV: 'test' },
              },
            },
          },
        }),
      ).toThrow();
    }
  });
});
