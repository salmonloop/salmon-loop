import { describe, expect, it } from 'bun:test';

import { mergeResolvedExtensions } from '../../../../src/core/extensions/merge.js';

function mcpCapabilities() {
  return {
    tools: {
      exposeToModel: true,
      allow: ['*'],
      phases: ['VERIFY' as const],
      approval: 'ask' as const,
    },
    resources: {
      allowUris: [],
      autoInclude: false,
      subscribe: false,
      maxBytes: 64_000,
      ttlMs: 30_000,
    },
    prompts: {
      exposeAs: 'none' as const,
      allow: [],
    },
    roots: { mode: 'none' as const },
    sampling: { enabled: false, maxTokens: 0, maxDepth: 0 },
    elicitation: { enabled: false },
  };
}

describe('mergeResolvedExtensions', () => {
  it('keeps configured extensions available when a task adds session extensions', () => {
    const merged = mergeResolvedExtensions(
      {
        mcpServers: [
          {
            name: 'repo-tools',
            enabled: true,
            transport: {
              type: 'stdio',
              command: 'repo-mcp',
              args: [],
              env: {},
            },
            auth: { type: 'none', scopes: [] },
            trust: 'local',
            capabilities: mcpCapabilities(),
            scope: 'repo',
          },
        ],
        toolPlugins: [
          {
            id: 'repo-plugin',
            enabled: true,
            path: '/repo/.salmonloop/tools/repo-plugin',
            allowUserScope: false,
            scope: 'repo',
          },
        ],
        skillDiscovery: {
          paths: ['/repo/.salmonloop/skills'],
          scope: 'repo',
        },
      },
      {
        mcpServers: [
          {
            name: 'acp-tools',
            enabled: true,
            transport: {
              type: 'http',
              url: 'http://127.0.0.1:9876/mcp',
              headers: {},
            },
            auth: { type: 'none', scopes: [] },
            trust: 'remote',
            capabilities: mcpCapabilities(),
            scope: 'repo',
          },
        ],
        toolPlugins: [],
        skillDiscovery: {
          paths: [],
          scope: 'repo',
        },
      },
    );

    expect(merged.mcpServers.map((server) => server.name)).toEqual(['repo-tools', 'acp-tools']);
    expect(merged.toolPlugins.map((plugin) => plugin.id)).toEqual(['repo-plugin']);
    expect(merged.skillDiscovery.paths).toEqual(['/repo/.salmonloop/skills']);
    expect(merged.skillDiscovery.scope).toBe('repo');
  });
});
