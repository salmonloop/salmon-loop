import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import { describe, expect, it, mock } from 'bun:test';

import { createAcpToolAuthorizationProvider } from '../../../src/core/protocols/acp/permission-provider.js';

describe('ACP permission provider', () => {
  it('maps allow_once selection to allow_once decision', async () => {
    const sessionUpdate = mock(async (_params: any) => {});
    const conn: Partial<AgentSideConnection> = {
      requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }),
      sessionUpdate,
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
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    const lastCall = sessionUpdate.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({
      sessionId: 'sess_1',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'in_progress' },
    });
  });

  it('denies fs_write when client fs.writeTextFile is not supported', async () => {
    const sessionUpdate = mock(async (_params: any) => {});
    const conn: Partial<AgentSideConnection> = {
      requestPermission: async () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }),
      sessionUpdate,
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
    expect(sessionUpdate).toHaveBeenCalledTimes(0);
  });

  it('ignores client capability matrix when enforcement is disabled', async () => {
    const sessionUpdate = mock(async (_params: any) => {});
    const provider = createAcpToolAuthorizationProvider({
      conn: {
        requestPermission: async () => ({
          outcome: { outcome: 'selected', optionId: 'allow_once' },
        }),
        sessionUpdate,
      } as any,
      sessionId: 'sess_1',
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      } as any,
      enforceClientCapabilities: false,
    });

    const decision = await provider.requestAuthorization({
      id: 'req-1',
      toolName: 'terminal.exec',
      argsSummary: 'echo hi',
      riskLevel: 'low',
      sideEffects: ['process'],
    } as any);

    expect(decision.outcome).not.toBe('deny');
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    const lastCall = sessionUpdate.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({
      sessionId: 'sess_1',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'req-1', status: 'in_progress' },
    });
  });

  it('emits in_progress update for auto-allowed tools when session policy is allow_all', async () => {
    const requestPermission = mock(
      async () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }) as any,
    );
    const sessionUpdate = mock(async (_params: any) => {});

    const provider = createAcpToolAuthorizationProvider({
      conn: { requestPermission, sessionUpdate } as unknown as AgentSideConnection,
      sessionId: 'sess_1',
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      getPermissionPolicy: () => 'allow_all',
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

    expect(decision).toMatchObject({ outcome: 'allow_session', source: 'auto' });
    expect(requestPermission).toHaveBeenCalledTimes(0);
    expect(sessionUpdate).toHaveBeenCalledTimes(1);
    const lastCall = sessionUpdate.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({
      sessionId: 'sess_1',
      update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'in_progress' },
    });
  });

  it('denies side-effecting tools when session config sets deny_all policy', async () => {
    const requestPermission = mock(
      async () => ({ outcome: { outcome: 'selected', optionId: 'allow_once' } }) as any,
    );
    const sessionUpdate = mock(async (_params: any) => {});

    const provider = createAcpToolAuthorizationProvider({
      conn: { requestPermission, sessionUpdate } as unknown as AgentSideConnection,
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
    expect(sessionUpdate).toHaveBeenCalledTimes(0);
  });
});
