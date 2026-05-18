import { describe, expect, test } from 'bun:test';

import { createSalmonTaskExecutor } from '../../../../../src/core/backends/salmon-loop/task-executor.js';
import { text } from '../../../../../src/locales/index.js';

describe('salmon task executor', () => {
  test('maps a canonical task request into loop options', async () => {
    let observedOptions: any = null;
    const extensions = {
      mcpServers: [],
      toolPlugins: [],
      skillDiscovery: { paths: [], scope: 'repo' as const },
    };
    const executor = createSalmonTaskExecutor({
      runLoop: async (options) => {
        observedOptions = options;
        return {
          success: true,
          reason: 'ok',
          reasonCode: 'SUCCESS',
          attempts: 1,
          logs: [],
        };
      },
    });

    const result = await executor.execute({
      id: 'task_1',
      capability: 'patch',
      state: 'accepted',
      request: {
        instruction: 'fix bug',
        checkpointSessionId: 'acp-sess-1',
        repoPath: '/workspace/repo',
        extensions,
      },
      createdAt: '2026-02-28T00:00:00.000Z',
    });

    expect(result.state).toBe('completed');
    expect(observedOptions?.instruction).toBe('fix bug');
    expect(observedOptions?.checkpointSessionId).toBe('acp-sess-1');
    expect(observedOptions?.repoPath).toBe('/workspace/repo');
    expect(observedOptions?.extensions).toBe(extensions);
  });

  test('preserves merged extensions assembled before execution', async () => {
    let observedOptions: any = null;
    const extensions = {
      mcpServers: [
        {
          name: 'repo-tools',
          enabled: true,
          transport: 'stdio' as const,
          command: 'repo-mcp',
          args: [],
          env: {},
          allowTools: ['*'],
          allowResources: [],
          scope: 'repo' as const,
        },
        {
          name: 'acp-tools',
          enabled: true,
          transport: 'http' as const,
          url: 'http://127.0.0.1:7777/mcp',
          headers: {},
          allowTools: ['*'],
          allowResources: [],
          scope: 'repo' as const,
        },
      ],
      toolPlugins: [
        {
          id: 'repo-plugin',
          enabled: true,
          path: '/workspace/.salmonloop/tools/repo-plugin',
          allowUserScope: false,
          scope: 'repo' as const,
        },
      ],
      skillDiscovery: { paths: ['/workspace/.salmonloop/skills'], scope: 'repo' as const },
    };
    const executor = createSalmonTaskExecutor({
      runLoop: async (options) => {
        observedOptions = options;
        return {
          success: true,
          reason: 'ok',
          reasonCode: 'SUCCESS',
          attempts: 1,
          logs: [],
        };
      },
    });

    const result = await executor.execute({
      id: 'task_extensions',
      capability: 'patch',
      state: 'accepted',
      request: {
        instruction: 'use all configured tools',
        extensions,
      },
      createdAt: '2026-02-28T00:00:00.000Z',
    });

    expect(result.state).toBe('completed');
    expect(observedOptions?.extensions?.mcpServers.map((server: any) => server.name)).toEqual([
      'repo-tools',
      'acp-tools',
    ]);
    expect(observedOptions?.extensions?.toolPlugins.map((plugin: any) => plugin.id)).toEqual([
      'repo-plugin',
    ]);
    expect(observedOptions?.extensions?.skillDiscovery.paths).toEqual([
      '/workspace/.salmonloop/skills',
    ]);
  });

  test('marks task as failed when loop execution fails', async () => {
    const executor = createSalmonTaskExecutor({
      runLoop: async () => ({
        success: false,
        reason: 'ERR_TECHNICAL_DETAILS_HIDDEN',
        reasonCode: 'LOOP_FAILED',
        errorCode: 'PREFLIGHT_NOT_GIT',
        attempts: 0,
        logs: [],
      }),
    });

    const result = await executor.execute({
      id: 'task_2',
      capability: 'patch',
      state: 'accepted',
      request: { instruction: 'fix bug' },
      createdAt: '2026-02-28T00:00:00.000Z',
    });

    expect(result.state).toBe('failed');
    expect(result.failure).toMatchObject({
      code: 'PREFLIGHT_NOT_GIT',
      message: text.errors.preflightNotGit,
      category: 'infrastructure',
    });
    expect(result.statusMessage).toBe(text.errors.preflightNotGit);
  });
});
