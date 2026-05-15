import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { execa } from 'execa';

mock.module('execa', () => {
  return {
    execa: mock(),
  };
});

import { requestNonInteractiveAuthorizationDecision } from '../../../../src/cli/authorization/non-interactive.js';
import type { ToolAuthorizationConfig } from '../../../../src/core/config/types.js';
import { setLogger, createLogger } from '../../../../src/core/observability/logger.js';
import type { ToolAuthorizationRequest } from '../../../../src/core/tools/authorization/types.js';

const request: ToolAuthorizationRequest = {
  id: 'req-1',
  toolName: 'proposal.apply',
  source: 'builtin',
  phase: 'VERIFY',
  riskLevel: 'high',
  sideEffects: ['fs_write'],
  repoRoot: '/repo',
  worktreeRoot: '/repo/.work',
  attemptId: 1,
  timestamp: Date.now(),
};

describe('non-interactive authorization handler', () => {
  beforeEach(() => {
    (execa as any).mockReset();
    setLogger(createLogger({ silent: true }));
  });

  it('uses command strategy and returns allow decision with source=hook', async () => {
    (execa as any).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ outcome: 'allow_once' }),
      stderr: '',
    } as any);

    const config: ToolAuthorizationConfig = {
      nonInteractive: { strategy: 'command', command: { cmd: 'echo ok' } },
    };

    const decision = await requestNonInteractiveAuthorizationDecision({ request, config });

    // Test that we are now utilizing the getPlatformShellInvocation signature properly
    expect((execa as any).mock.calls[0]).toMatchObject([
      expect.stringMatching(/sh|cmd.exe/),
      expect.arrayContaining([expect.stringContaining('echo ok')]),
      expect.any(Object),
    ]);
    expect(decision).toEqual({ outcome: 'allow_once', source: 'hook' });
  });

  it('fails closed when command returns invalid JSON', async () => {
    (execa as any).mockResolvedValue({
      exitCode: 0,
      stdout: 'not-json',
      stderr: '',
    } as any);

    const config: ToolAuthorizationConfig = {
      nonInteractive: { strategy: 'command', command: { cmd: 'echo bad' } },
    };

    const decision = await requestNonInteractiveAuthorizationDecision({ request, config });

    expect((execa as any).mock.calls[0]).toMatchObject([
      expect.stringMatching(/sh|cmd.exe/),
      expect.arrayContaining([expect.stringContaining('echo bad')]),
      expect.any(Object),
    ]);
    expect(decision?.outcome).toBe('deny');
    expect(decision?.source).toBe('hook');
  });

  it('fails closed when MCP server cannot be resolved', async () => {
    const config: ToolAuthorizationConfig = {
      nonInteractive: { strategy: 'mcp', mcp: { server: 'missing', tool: 'approve' } },
    };

    const decision = await requestNonInteractiveAuthorizationDecision({
      request,
      config,
      extensions: {
        mcpServers: [],
        toolPlugins: [],
        skillDiscovery: { paths: [], scope: 'repo' },
      },
    });
    expect(decision?.outcome).toBe('deny');
    expect(decision?.source).toBe('hook');
  });
});
