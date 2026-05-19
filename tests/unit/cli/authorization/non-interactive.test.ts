import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { execa } from 'execa';

mock.module('execa', () => {
  return {
    execa: mock(),
  };
});

const mcpStartMock = mock(async () => {});
const mcpStopMock = mock(async () => {});
const mcpListToolsMock = mock(async (): Promise<any> => []);
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
  McpClient: class {
    start = mcpStartMock;
    stop = mcpStopMock;
    listTools = mcpListToolsMock;
    callTool = mcpCallToolMock;
  },
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
    mcpListToolsMock.mockReset();
    mcpListToolsMock.mockImplementation(async () => []);
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
      extensions: {
        mcpServers: [
          {
            name: 'authz',
            enabled: true,
            transport: 'stdio',
            command: 'authz-server',
            args: [],
            env: {},
            allowTools: ['approve'],
            allowResources: [],
            scope: 'repo',
          },
        ],
        toolPlugins: [],
        skillDiscovery: { paths: [], scope: 'repo' },
      },
    });

    expect(decision).toEqual({ outcome: 'allow_session', source: 'hook' });
    expect(mcpCallToolMock).toHaveBeenCalledWith('approve', { request });
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
      extensions: {
        mcpServers: [
          {
            name: 'authz',
            enabled: true,
            transport: 'http',
            url: 'https://example.com/mcp',
            headers: {},
            allowTools: ['approve'],
            allowResources: [],
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
