import { beforeEach, describe, expect, it, mock } from 'bun:test';

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
  });

  it('passes contextSnapshot fields into the spawned init context', async () => {
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
      planRuntime: {
        sessionId: 'plan-1',
        planPathHint: '.salmonloop/plan.md',
      },
      cacheSharing: {
        namespace: 'subagent-shared',
        contextHash: 'abc123',
      },
    };

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
    expect(initCtx.planRuntime).toEqual({
      sessionId: 'plan-1',
      planPathHint: '.salmonloop/plan.md',
    });
    expect(initCtx.planRuntime).toBe(requestSnapshot.planRuntime);
    expect(initCtx.cacheSharing).toEqual({
      namespace: 'subagent-shared',
      contextHash: 'abc123',
    });
    expect(initCtx.cacheSharing).toBe(requestSnapshot.cacheSharing);
  });
});
