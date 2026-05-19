import { describe, expect, it } from 'bun:test';

import { McpConfigSchema } from '../../../../src/core/extensions/schemas.js';
import { buildResolvedMcpServersV2 } from '../../../../src/core/mcp/config/index.js';
import { McpConfigV2Schema } from '../../../../src/core/mcp/config/schema-v2.js';

describe('MCP config v2', () => {
  it('parses stdio server entries with explicit env', () => {
    const parsed = McpConfigV2Schema.parse({
      version: 2,
      servers: {
        local: {
          transport: {
            type: 'stdio',
            command: 'node',
            args: ['server.js'],
            env: { NODE_ENV: 'test' },
            cwd: '.',
          },
          auth: { type: 'none' },
          trust: 'local',
          capabilities: {
            tools: {
              exposeToModel: true,
              allow: ['*'],
            },
          },
        },
      },
    });

    expect(parsed.servers.local.transport).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
      cwd: '.',
    });
    expect(parsed.servers.local.capabilities.tools.exposeToModel).toBe(true);
    expect(parsed.servers.local.capabilities.tools.allow).toEqual(['*']);
    expect(parsed.servers.local.capabilities.resources.allowUris).toEqual([]);

    const [resolved] = buildResolvedMcpServersV2(
      [{ key: 'local', entry: parsed.servers.local, scope: 'repo' }],
      '/repo',
    );
    expect(resolved).toMatchObject({
      name: 'local',
      enabled: true,
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { NODE_ENV: 'test' },
      },
      trust: 'local',
      scope: 'repo',
    });
  });

  it('parses http server entries with oauth auth', () => {
    const parsed = McpConfigV2Schema.parse({
      version: 2,
      servers: {
        remote: {
          enabled: false,
          transport: {
            type: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer token' },
          },
          auth: {
            type: 'oauth',
            scopes: ['mcp.read'],
          },
          trust: 'remote',
          capabilities: {
            resources: {
              allowUris: ['https://example.com/resource'],
            },
            prompts: {
              exposeAs: 'slash',
              allow: ['deploy'],
            },
          },
        },
      },
    });

    expect(parsed.servers.remote).toMatchObject({
      enabled: false,
      transport: {
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
      },
      auth: {
        type: 'oauth',
        scopes: ['mcp.read'],
      },
      trust: 'remote',
    });
    expect(parsed.servers.remote.capabilities.resources.allowUris).toEqual([
      'https://example.com/resource',
    ]);
    expect(parsed.servers.remote.capabilities.prompts.exposeAs).toBe('slash');
    expect(parsed.servers.remote.capabilities.tools.exposeToModel).toBe(false);
  });

  it('rejects v1 configs through the extensions MCP schema', () => {
    expect(() =>
      McpConfigSchema.parse({
        version: 1,
        servers: {
          old: {
            command: 'node',
            args: ['server.js'],
            env: { NODE_ENV: 'test' },
            allow: { tools: ['*'] },
          },
        },
      }),
    ).toThrow();
  });

  it('rejects stdio-only fields on http transports', () => {
    for (const field of ['args', 'cwd', 'env'] as const) {
      expect(() =>
        McpConfigV2Schema.parse({
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

  it('defaults all capabilities to deny', () => {
    const parsed = McpConfigV2Schema.parse({
      version: 2,
      servers: {
        local: {
          transport: {
            type: 'stdio',
            command: 'node',
            env: {},
          },
        },
      },
    });

    expect(parsed.servers.local.capabilities).toEqual({
      tools: {
        exposeToModel: false,
        allow: [],
        phases: [],
        approval: 'ask',
      },
      resources: {
        allowUris: [],
        autoInclude: false,
        subscribe: false,
        maxBytes: 64_000,
        ttlMs: 30_000,
      },
      prompts: {
        exposeAs: 'none',
        allow: [],
      },
      roots: {
        mode: 'none',
      },
      sampling: {
        enabled: false,
        maxTokens: 0,
        maxDepth: 0,
      },
      elicitation: {
        enabled: false,
      },
    });
  });

  it('requires stdio env to be an explicit object', () => {
    expect(() =>
      McpConfigV2Schema.parse({
        version: 2,
        servers: {
          local: {
            transport: {
              type: 'stdio',
              command: 'node',
            },
          },
        },
      }),
    ).toThrow();
  });
});
