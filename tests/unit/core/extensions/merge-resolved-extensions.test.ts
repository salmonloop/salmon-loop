import { describe, expect, it } from 'bun:test';

import { mergeResolvedExtensions } from '../../../../src/core/extensions/merge.js';

describe('mergeResolvedExtensions', () => {
  it('keeps configured extensions available when a task adds session extensions', () => {
    const merged = mergeResolvedExtensions(
      {
        mcpServers: [
          {
            name: 'repo-tools',
            enabled: true,
            transport: 'stdio',
            command: 'repo-mcp',
            args: [],
            env: {},
            allowTools: ['*'],
            allowResources: [],
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
            transport: 'http',
            url: 'http://127.0.0.1:9876/mcp',
            headers: {},
            allowTools: ['*'],
            allowResources: [],
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
