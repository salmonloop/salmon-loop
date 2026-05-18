import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { clearAuditTrail, getAuditTrail } from '../../../src/core/observability/audit-trail.js';

const executeMock = mock(async (request: any) => ({
  agent_ref: request.agent_ref ?? 'surgeon',
  success: true,
  summary: 'ok',
  tokenUsage: 0,
  attempts: 1,
  logs: [],
}));

mock.module('../../../src/core/sub-agent/core/manager.js', () => ({
  SubAgentManager: class {
    constructor(_ctx: unknown, _controller: unknown) {}

    execute(request: any) {
      return executeMock(request);
    }
  },
}));

mock.module('../../../src/core/sub-agent/controller.js', () => ({
  createSubAgentController: () => ({
    registerAgent: mock(),
    updateStatus: mock(),
    appendLog: mock(),
    listAgents: mock(() => []),
    getAgent: mock(() => undefined),
    tailLogs: mock(() => []),
    requestStop: mock(() => true),
    isStopRequested: mock(() => false),
  }),
}));

describe('sub-agent task-spawn context snapshot injection', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    clearAuditTrail();
  });

  it('injects runtime contextSnapshot for shared sessions', async () => {
    const { subAgentTaskSpec } = await import('../../../src/core/sub-agent/tools/task-spawn.js');
    const runtimeSnapshot = {
      conversationContext: [{ role: 'assistant', content: 'from runtime' }],
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
          phase: 'PLAN',
          round: 0,
          callId: 'call-1',
          toolName: 'fs.read',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        },
      ],
      replacementState: {
        schemaVersion: 1,
        entries: {
          'tool-1': {
            toolResultId: 'tool-1',
            decision: 'replaced',
            preview: 'preview',
            frozenAt: 10,
            sourceArtifactHandle: 's8p://artifact/tool-preview-123',
            identityVersion: 'v1',
            hashAlgorithm: 'sha256',
          },
        },
      },
      planRuntime: { sessionId: 'plan-1', planPathHint: '.salmonloop/plan.md' },
      cacheSharing: {
        namespace: 'plan',
        contextHash: 'ctx-shared',
        toolSchemaHash: 'tool-hash-1',
        systemPrefixDigest: 'prefix-1',
      },
    };

    await subAgentTaskSpec.executor(
      {
        agent_ref: 'surgeon',
        task: 'fix bug',
        session_target: 'shared',
        contextSnapshot: {
          conversationContext: [{ role: 'user', content: 'from request' }],
          cacheSharing: {
            namespace: 'plan',
            contextHash: 'ctx-shared',
            toolSchemaHash: 'tool-hash-1',
            systemPrefixDigest: 'prefix-1',
          },
        },
      },
      {
        repoRoot: '/repo',
        attemptId: 1,
        dryRun: false,
        contextSnapshot: runtimeSnapshot,
      } as any,
    );

    expect(executeMock).toHaveBeenCalledTimes(1);
    const forwarded = executeMock.mock.calls[0]?.[0];
    expect(forwarded.contextSnapshot?.conversationContext).toEqual([
      { role: 'assistant', content: 'from runtime' },
    ]);
    expect(forwarded.contextSnapshot?.planRuntime).toEqual({
      sessionId: 'plan-1',
      planPathHint: '.salmonloop/plan.md',
    });
    expect(forwarded.contextSnapshot?.conversationContext).not.toBe(
      runtimeSnapshot.conversationContext,
    );
    expect(forwarded.contextSnapshot?.artifactHints).not.toBe(runtimeSnapshot.artifactHints);
    expect(forwarded.contextSnapshot?.artifactHints?.toolResultPreviewArtifacts).not.toBe(
      runtimeSnapshot.artifactHints.toolResultPreviewArtifacts,
    );
    expect(forwarded.contextSnapshot?.toolCallingAudit).not.toBe(runtimeSnapshot.toolCallingAudit);
    expect(forwarded.contextSnapshot?.replacementState).toEqual(runtimeSnapshot.replacementState);
    expect(forwarded.contextSnapshot?.replacementState).not.toBe(runtimeSnapshot.replacementState);
    expect(forwarded.contextSnapshot?.planRuntime).toBe(runtimeSnapshot.planRuntime);
    expect(forwarded.contextSnapshot?.cacheSharing).toBe(runtimeSnapshot.cacheSharing);
  });

  it('preserves request contextSnapshot for isolated sessions', async () => {
    const { subAgentTaskSpec } = await import('../../../src/core/sub-agent/tools/task-spawn.js');

    await subAgentTaskSpec.executor(
      {
        agent_ref: 'surgeon',
        task: 'fix bug',
        session_target: 'isolated',
        contextSnapshot: {
          conversationContext: [{ role: 'user', content: 'from request' }],
        },
      },
      {
        repoRoot: '/repo',
        attemptId: 1,
        dryRun: false,
        contextSnapshot: {
          conversationContext: [{ role: 'assistant', content: 'from runtime' }],
        },
      } as any,
    );

    expect(executeMock).toHaveBeenCalledTimes(1);
    const forwarded = executeMock.mock.calls[0]?.[0];
    expect(forwarded.contextSnapshot?.conversationContext).toEqual([
      { role: 'user', content: 'from request' },
    ]);
  });

  it('normalizes minimal coder delegation requests to isolated patch proposals', async () => {
    const { subAgentTaskSpec } = await import('../../../src/core/sub-agent/tools/task-spawn.js');

    await subAgentTaskSpec.executor(
      {
        agent_ref: 'surgeon',
        task: 'diagnose failing tests and propose a fix',
      },
      {
        repoRoot: '/repo',
        attemptId: 1,
        dryRun: false,
      } as any,
    );

    expect(executeMock).toHaveBeenCalledTimes(1);
    const forwarded = executeMock.mock.calls[0]?.[0];
    expect(forwarded).toEqual(
      expect.objectContaining({
        agent_ref: 'surgeon',
        task: 'diagnose failing tests and propose a fix',
        session_target: 'isolated',
        expected_output: 'patch',
      }),
    );
  });

  it('keeps agent_dispatch examples model-visible without making empty input valid', async () => {
    const { subAgentTaskSpec } = await import('../../../src/core/sub-agent/tools/task-spawn.js');

    expect(subAgentTaskSpec.examples?.length).toBeGreaterThan(0);
    expect(subAgentTaskSpec.examples?.[0]?.input).toEqual(
      expect.objectContaining({
        agent_ref: 'explorer',
        task: expect.stringContaining('Inspect'),
      }),
    );
    expect(subAgentTaskSpec.inputSchema.safeParse({}).success).toBe(false);
  });

  it('falls back to isolated mode when shared prefix consistency mismatches', async () => {
    const { subAgentTaskSpec } = await import('../../../src/core/sub-agent/tools/task-spawn.js');

    await subAgentTaskSpec.executor(
      {
        agent_ref: 'surgeon',
        task: 'fix bug',
        session_target: 'shared',
        contextSnapshot: {
          conversationContext: [{ role: 'user', content: 'from request' }],
          cacheSharing: {
            namespace: 'plan',
            contextHash: 'ctx-request',
            toolSchemaHash: 'tool-hash-request',
            systemPrefixDigest: 'prefix-request',
          },
        },
      },
      {
        repoRoot: '/repo',
        attemptId: 1,
        dryRun: false,
        phase: 'PLAN',
        contextSnapshot: {
          conversationContext: [{ role: 'assistant', content: 'from runtime' }],
          cacheSharing: {
            namespace: 'plan',
            contextHash: 'ctx-runtime',
            toolSchemaHash: 'tool-hash-runtime',
            systemPrefixDigest: 'prefix-runtime',
          },
        },
      } as any,
    );

    const forwarded = executeMock.mock.calls[0]?.[0];
    expect(forwarded.session_target).toBe('isolated');
    expect(forwarded.contextSnapshot).toBeUndefined();
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
