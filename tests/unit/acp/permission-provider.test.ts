import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import { describe, expect, it, mock } from 'bun:test';

import { createAcpToolAuthorizationProvider } from '../../../src/core/protocols/acp/permission-provider.js';

describe('ACP permission provider', () => {
  it('maps allow_once selection to allow_once decision', async () => {
    const conn: Partial<AgentSideConnection> = {
      requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }),
    };

    const provider = createAcpToolAuthorizationProvider({
      conn: conn as AgentSideConnection,
      sessionId: 'sess_1',
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    });

    const decision = await provider.requestAuthorization({
      id: 'call_1',
      toolName: 'fs.write',
      source: 'builtin',
      phase: 'PATCH',
      riskLevel: 'high',
      sideEffects: ['fs_write'],
      argsSummary: 'write /tmp/x',
      repoRoot: '/repo',
      attemptId: 1,
      timestamp: Date.now(),
    });

    expect(decision.outcome).toBe('allow_once');
  });

  it('denies fs_write when client fs.writeTextFile is not supported', async () => {
    const conn: Partial<AgentSideConnection> = {
      requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }),
    };

    const provider = createAcpToolAuthorizationProvider({
      conn: conn as AgentSideConnection,
      sessionId: 'sess_1',
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: true },
    });

    const decision = await provider.requestAuthorization({
      id: 'call_1',
      toolName: 'fs.write',
      source: 'builtin',
      phase: 'PATCH',
      riskLevel: 'high',
      sideEffects: ['fs_write'],
      argsSummary: 'write /tmp/x',
      repoRoot: '/repo',
      attemptId: 1,
      timestamp: Date.now(),
    });

    expect(decision.outcome).toBe('deny');
  });

  it('denies side-effecting tools when session config sets deny_all policy', async () => {
    const requestPermission = mock(
      async () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }) as any,
    );

    const provider = createAcpToolAuthorizationProvider({
      conn: { requestPermission } as unknown as AgentSideConnection,
      sessionId: 'sess_1',
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      getPermissionPolicy: () => 'deny_all',
    });

    const decision = await provider.requestAuthorization({
      id: 'call_1',
      toolName: 'fs.write',
      source: 'builtin',
      phase: 'PATCH',
      riskLevel: 'high',
      sideEffects: ['fs_write'],
      argsSummary: 'write /tmp/x',
      repoRoot: '/repo',
      attemptId: 1,
      timestamp: Date.now(),
    });

    expect(decision).toMatchObject({
      outcome: 'deny',
      source: 'auto',
      reason: 'session_config:deny_all',
    });
    expect(requestPermission).toHaveBeenCalledTimes(0);
  });
});
