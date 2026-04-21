import { describe, expect, it, mock } from 'bun:test';

import { buildPhaseToolRuntimeContext } from '../../../../../src/core/grizzco/steps/tool-runtime.js';
import { Phase } from '../../../../../src/core/types/runtime.js';

describe('buildPhaseToolRuntimeContext', () => {
  it('builds shared runtime context with sub-agent snapshot fields', () => {
    const llm = {
      getModelId: () => 'test-model',
      chat: mock(),
      createPlan: mock(),
      createPatch: mock(),
    };

    const conversationContext = [{ role: 'user' as const, content: 'previous context' }];
    const artifactHints = {
      verifyArtifact: {
        handle: 's8p://artifact/verify-1',
        mimeType: 'text/plain',
        sha256: 'verify',
        size: 12,
      },
    };
    const toolCallingAudit = [
      {
        timestamp: new Date().toISOString(),
        phase: 'PLAN' as const,
        round: 0,
        callId: 'call-1',
        toolName: 'fs.read',
        rawArgsType: 'string',
        parsedArgsOk: true,
        toolResultStatus: 'ok' as const,
      },
    ];
    const planRuntime = {
      sessionId: 'plan-1',
      planPathHint: '.salmonloop/plan.md',
    };

    const runtime = buildPhaseToolRuntimeContext(
      {
        workspace: {
          workPath: '/repo-shadow',
          baseRepoPath: '/repo',
          strategy: 'worktree',
        },
        mode: 'patch',
        attempt: 3,
        options: {
          llm,
          dryRun: true,
          userInputProvider: mock(),
          agentKind: 'primary',
          languagePlugins: undefined,
          subAgentController: undefined,
          conversationContext,
        },
        artifactHints,
        toolCallingAudit,
        planRuntime,
      } as any,
      Phase.EXPLORE,
      {
        namespace: 'explore',
        contextHash: 'ctx-123',
      },
    );

    expect(runtime).toMatchObject({
      repoRoot: '/repo-shadow',
      persistenceRoot: '/repo',
      worktreeRoot: '/repo-shadow',
      attemptId: 3,
      dryRun: true,
      model: 'test-model',
      phase: Phase.EXPLORE,
      contextSnapshot: {
        conversationContext,
        artifactHints,
        toolCallingAudit,
        planRuntime,
        cacheSharing: expect.objectContaining({
          namespace: 'explore',
          contextHash: 'ctx-123',
          toolSchemaHash: expect.any(String),
          systemPrefixDigest: expect.any(String),
        }),
      },
    });
  });

  it('propagates flowMode into the host-only tool runtime context', () => {
    const llm = {
      getModelId: () => 'test-model',
      chat: mock(),
      createPlan: mock(),
      createPatch: mock(),
    };

    const runtime = buildPhaseToolRuntimeContext(
      {
        workspace: {
          workPath: '/repo',
          baseRepoPath: '/repo',
          strategy: 'direct',
        },
        mode: 'autopilot',
        attempt: 1,
        options: {
          llm,
          dryRun: false,
          conversationContext: [],
        },
      } as any,
      Phase.AUTOPILOT,
      {},
    );

    expect(runtime.flowMode).toBe('autopilot');
  });
});
