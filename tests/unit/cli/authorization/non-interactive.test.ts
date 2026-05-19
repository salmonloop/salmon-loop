import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { execa } from 'execa';

mock.module('execa', () => {
  return {
    execa: mock(),
  };
});

const mcpStartMock = mock(async () => {});
const mcpStopMock = mock(async () => {});
const mcpCallToolMock = mock(async (): Promise<any> => ({ outcome: 'allow_once' }));
const loggerMock = {
  info: mock(),
  warn: mock(),
  error: mock(),
  success: mock(),
  debug: mock(),
};

mock.module('../../../../src/core/facades/cli-authorization-non-interactive.js', () => ({
  getLogger: () => loggerMock,
}));

import { requestNonInteractiveAuthorizationDecision } from '../../../../src/cli/authorization/non-interactive.js';
import type { ToolAuthorizationConfig } from '../../../../src/core/config/types.js';
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

function mcpConnectionManagerFactory() {
  return {
    startAll: mcpStartMock,
    stopAll: mcpStopMock,
    callTool: mcpCallToolMock,
  };
}

function mcpCapabilities() {
  return {
    tools: {
      exposeToModel: true,
      allow: ['approve'],
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

describe('non-interactive authorization handler', () => {
  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    (execa as any).mockReset();
    mcpStartMock.mockReset();
    mcpStartMock.mockImplementation(async () => {});
    mcpStopMock.mockReset();
    mcpStopMock.mockImplementation(async () => {});
    mcpCallToolMock.mockReset();
    mcpCallToolMock.mockImplementation(async () => ({ outcome: 'allow_once' }));
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
      mcpConnectionManagerFactory,
      extensions: {
        mcpServers: [],
        toolPlugins: [],
        skillDiscovery: { paths: [], scope: 'repo' },
      },
    });
    expect(decision?.outcome).toBe('deny');
    expect(decision?.source).toBe('hook');
  });

  it('uses MCP strategy and normalizes a valid decision', async () => {
    mcpCallToolMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ outcome: 'allow_session' }) }],
    });
    const config: ToolAuthorizationConfig = {
      nonInteractive: { strategy: 'mcp', mcp: { server: 'authz', tool: 'approve' } },
    };

    const decision = await requestNonInteractiveAuthorizationDecision({
      request,
      config,
      mcpConnectionManagerFactory,
      extensions: {
        mcpServers: [
          {
            name: 'authz',
            enabled: true,
            transport: {
              type: 'stdio',
              command: 'authz-server',
              args: [],
              env: {},
            },
            auth: { type: 'none', scopes: [] },
            trust: 'local',
            capabilities: mcpCapabilities(),
            scope: 'repo',
          },
        ],
        toolPlugins: [],
        skillDiscovery: { paths: [], scope: 'repo' },
      },
    });

    expect(decision).toEqual({ outcome: 'allow_session', source: 'hook' });
    expect(mcpCallToolMock).toHaveBeenCalledWith(
      'authz',
      'approve',
      { request },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mcpStopMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when MCP tool returns invalid decision', async () => {
    mcpCallToolMock.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"bad":true}' }] });
    const config: ToolAuthorizationConfig = {
      nonInteractive: { strategy: 'mcp', mcp: { server: 'authz', tool: 'approve' } },
    };

    const decision = await requestNonInteractiveAuthorizationDecision({
      request,
      config,
      mcpConnectionManagerFactory,
      extensions: {
        mcpServers: [
          {
            name: 'authz',
            enabled: true,
            transport: {
              type: 'http',
              url: 'https://example.com/mcp',
              headers: {},
            },
            auth: { type: 'none', scopes: [] },
            trust: 'remote',
            capabilities: mcpCapabilities(),
            scope: 'repo',
          },
        ],
        toolPlugins: [],
        skillDiscovery: { paths: [], scope: 'repo' },
      },
    });

    expect(decision?.outcome).toBe('deny');
    expect(decision?.source).toBe('hook');
    expect(mcpStopMock).toHaveBeenCalledTimes(1);
  });
});
