import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { clearAuditTrail, getAuditTrail } from '../../../src/core/observability/audit-trail.js';

const loopExecuteMock = mock(async (_initCtx: any) => ({
  agent_ref: 'surgeon',
  success: true,
  summary: 'ok',
  tokenUsage: 0,
  attempts: 1,
  logs: [],
}));

mock.module('../../../src/core/sub-agent/core/loop.js', () => ({
  SmallfryLoop: class {
    constructor(_profile: unknown) {}

    execute(initCtx: any) {
      return loopExecuteMock(initCtx);
    }
  },
}));

describe('SubAgentManager context snapshot', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    clearAuditTrail();
  });

  it('passes contextSnapshot fields into the spawned init context', async () => {
    const { SubAgentManager } = await import('../../../src/core/sub-agent/core/manager.js');

    const setup = mock(async () => undefined);
    const teardown = mock(async () => undefined);

    const requestSnapshot = {
      conversationContext: [{ role: 'user' as const, content: 'previous context' }],
      artifactHints: {
        verifyArtifact: {
          handle: 's8p://artifact/verify-1',
          mimeType: 'text/plain',
          sha256: 'verify',
          size: 12,
        },
        toolResultPreviewArtifacts: [
          {
            label: 'Tool result preview: web.search output',
            artifact: {
              handle: 's8p://artifact/tool-preview-123',
              mimeType: 'application/json',
              sha256: 'preview',
              size: 1600,
            },
          },
        ],
      },
      toolCallingAudit: [
        {
          timestamp: new Date().toISOString(),
          phase: 'PLAN' as const,
          round: 0,
          callId: 'call-1',
          toolName: 'fs.read',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        },
      ],
      replacementState: {
        schemaVersion: 1 as const,
        entries: {
          'tool-1': {
            toolResultId: 'tool-1',
            decision: 'replaced' as const,
            preview: 'preview',
            frozenAt: 10,
            sourceArtifactHandle: 's8p://artifact/tool-preview-123',
            identityVersion: 'v1' as const,
            hashAlgorithm: 'sha256' as const,
          },
        },
      },
      planRuntime: {
        sessionId: 'plan-1',
        planPathHint: '.salmonloop/plan.md',
      },
      cacheSharing: {
        namespace: 'subagent-shared',
        contextHash: 'abc123',
        toolSchemaHash: 'tool-hash-1',
        systemPrefixDigest: 'prefix-1',
      },
    };

    const manager = new SubAgentManager(
      {
        repoRoot: '/repo',
        persistenceRoot: '/repo',
        dryRun: false,
        contextSnapshot: requestSnapshot,
        llm: {
          chat: mock(),
          createPlan: mock(),
          createPatch: mock(),
        },
      } as any,
      {
        registerAgent: mock(),
        isStopRequested: mock(() => false),
        appendLog: mock(),
        updateStatus: mock(),
        listAgents: mock(() => []),
        getAgent: mock(() => undefined),
        tailLogs: mock(() => []),
        requestStop: mock(() => true),
      } as any,
      {
        registry: {
          get: mock(() => ({
            id: 'surgeon',
            name: 'Surgeon',
            role: 'Coder',
            description: 'test',
            allowedTools: ['fs.read'],
            readOnly: false,
            stratagem: 'surgeon',
            timeoutMs: 1000,
          })),
        },
        createRuntimeEnvironment: () =>
          ({
            setup,
            teardown,
            workspace: {
              workPath: '/repo-shadow',
              baseRepoPath: '/repo',
              strategy: 'worktree',
            },
            initialSnapshotHash: 'shadow-head',
          }) as any,
        artifactStore: {
          saveText: mock(),
        },
      } as any,
    );

    await manager.execute({
      agent_ref: 'surgeon',
      task: 'fix bug',
      session_target: 'shared',
      contextSnapshot: requestSnapshot,
    });

    const initCtx = loopExecuteMock.mock.calls[0]?.[0];
    expect(initCtx.options.conversationContext).toEqual([
      { role: 'user', content: 'previous context' },
    ]);
    expect(initCtx.options.conversationContext).not.toBe(requestSnapshot.conversationContext);
    expect(initCtx.artifactHints).toEqual({
      verifyArtifact: {
        handle: 's8p://artifact/verify-1',
        mimeType: 'text/plain',
        sha256: 'verify',
        size: 12,
      },
      toolResultPreviewArtifacts: [
        {
          label: 'Tool result preview: web.search output',
          artifact: {
            handle: 's8p://artifact/tool-preview-123',
            mimeType: 'application/json',
            sha256: 'preview',
            size: 1600,
          },
        },
      ],
    });
    expect(initCtx.artifactHints).not.toBe(requestSnapshot.artifactHints);
    expect(initCtx.artifactHints?.toolResultPreviewArtifacts).not.toBe(
      requestSnapshot.artifactHints.toolResultPreviewArtifacts,
    );
    expect(initCtx.toolCallingAudit).toHaveLength(1);
    expect(initCtx.toolCallingAudit).not.toBe(requestSnapshot.toolCallingAudit);
    expect(initCtx.replacementState).toEqual(requestSnapshot.replacementState);
    expect(initCtx.replacementState).not.toBe(requestSnapshot.replacementState);
    expect(initCtx.planRuntime).toEqual({
      sessionId: 'plan-1',
      planPathHint: '.salmonloop/plan.md',
    });
    expect(initCtx.planRuntime).toBe(requestSnapshot.planRuntime);
    expect(initCtx.cacheSharing).toEqual({
      namespace: 'subagent-shared',
      contextHash: 'abc123',
      toolSchemaHash: 'tool-hash-1',
      systemPrefixDigest: 'prefix-1',
    });
    expect(initCtx.cacheSharing).toBe(requestSnapshot.cacheSharing);
  });

  it('denies shared snapshot handoff when cache-critical digest fields are missing', async () => {
    const { SubAgentManager } = await import('../../../src/core/sub-agent/core/manager.js');

    const setup = mock(async () => undefined);
    const teardown = mock(async () => undefined);

    const manager = new SubAgentManager(
      {
        repoRoot: '/repo',
        persistenceRoot: '/repo',
        dryRun: false,
        llm: {
          chat: mock(),
          createPlan: mock(),
          createPatch: mock(),
        },
      } as any,
      {
        registerAgent: mock(),
        isStopRequested: mock(() => false),
        appendLog: mock(),
        updateStatus: mock(),
        listAgents: mock(() => []),
        getAgent: mock(() => undefined),
        tailLogs: mock(() => []),
        requestStop: mock(() => true),
      } as any,
      {
        registry: {
          get: mock(() => ({
            id: 'surgeon',
            name: 'Surgeon',
            role: 'Coder',
            description: 'test',
            allowedTools: ['fs.read'],
            readOnly: false,
            stratagem: 'surgeon',
            timeoutMs: 1000,
          })),
        },
        createRuntimeEnvironment: () =>
          ({
            setup,
            teardown,
            workspace: {
              workPath: '/repo-shadow',
              baseRepoPath: '/repo',
              strategy: 'worktree',
            },
            initialSnapshotHash: 'shadow-head',
          }) as any,
        artifactStore: {
          saveText: mock(),
        },
      } as any,
    );

    await manager.execute({
      agent_ref: 'surgeon',
      task: 'fix bug',
      session_target: 'shared',
      contextSnapshot: {
        cacheSharing: {
          namespace: 'shared',
          contextHash: 'ctx-only',
        },
      },
    } as any);

    const initCtx = loopExecuteMock.mock.calls[0]?.[0];
    expect(initCtx.cacheSharing).toBeUndefined();
  });

  it('falls back to isolated mode when runtime shared prefix mismatches request snapshot', async () => {
    const { SubAgentManager } = await import('../../../src/core/sub-agent/core/manager.js');

    const setup = mock(async () => undefined);
    const teardown = mock(async () => undefined);

    const manager = new SubAgentManager(
      {
        repoRoot: '/repo',
        persistenceRoot: '/repo',
        dryRun: false,
        phase: 'PLAN',
        contextSnapshot: {
          cacheSharing: {
            namespace: 'shared',
            contextHash: 'ctx-runtime',
            toolSchemaHash: 'tool-hash-runtime',
            systemPrefixDigest: 'prefix-runtime',
          },
        },
        llm: {
          chat: mock(),
          createPlan: mock(),
          createPatch: mock(),
        },
      } as any,
      {
        registerAgent: mock(),
        isStopRequested: mock(() => false),
        appendLog: mock(),
        updateStatus: mock(),
        listAgents: mock(() => []),
        getAgent: mock(() => undefined),
        tailLogs: mock(() => []),
        requestStop: mock(() => true),
      } as any,
      {
        registry: {
          get: mock(() => ({
            id: 'surgeon',
            name: 'Surgeon',
            role: 'Coder',
            description: 'test',
            allowedTools: ['fs.read'],
            readOnly: false,
            stratagem: 'surgeon',
            timeoutMs: 1000,
          })),
        },
        createRuntimeEnvironment: () =>
          ({
            setup,
            teardown,
            workspace: {
              workPath: '/repo-shadow',
              baseRepoPath: '/repo',
              strategy: 'worktree',
            },
            initialSnapshotHash: 'shadow-head',
          }) as any,
        artifactStore: {
          saveText: mock(),
        },
      } as any,
    );

    await manager.execute({
      agent_ref: 'surgeon',
      task: 'fix bug',
      session_target: 'shared',
      contextSnapshot: {
        cacheSharing: {
          namespace: 'shared',
          contextHash: 'ctx-request',
          toolSchemaHash: 'tool-hash-request',
          systemPrefixDigest: 'prefix-request',
        },
      },
    } as any);

    const initCtx = loopExecuteMock.mock.calls[0]?.[0];
    expect(initCtx.cacheSharing).toBeUndefined();
    const event = getAuditTrail().find(
      (entry) => entry.action === 'sub_agent.shared.prefix_consistency_failed',
    );
    expect(event).toBeDefined();
    expect(event?.details).toMatchObject({
      metric: 'shared_fallback_rate',
      fallbackMode: 'isolated',
      reason: 'cache_critical_prefix_mismatch',
    });
  });
});
