import { describe, expect, it, mock, spyOn } from 'bun:test';

import { generateResearch } from '../../../../../src/core/grizzco/steps/research.js';
import * as session from '../../../../../src/core/tools/session.js';
import { Phase } from '../../../../../src/core/types/index.js';

describe('generateResearch', () => {
  it('injects recent read artifact handles into the research request envelope', async () => {
    const captured: any[][] = [];
    const llm = {
      getCapabilities: () => ({ toolCalling: false }),
      chat: mock(async (messages: any) => {
        captured.push(messages.map((m: any) => ({ role: m.role, content: m.content })));
        return {
          role: 'assistant' as const,
          content: JSON.stringify({
            researchNotes: ['note'],
            researchFindings: [{ summary: 'finding' }],
            sources: [
              { toolName: 'web.search', summary: 'source', ok: true, timestamp: Date.now() },
            ],
            researchText: 'research summary',
          }),
        };
      }),
      createPlan: mock(),
      createPatch: mock(),
    };

    const ctx: any = {
      options: {
        llm,
        instruction: 'collect evidence',
        dryRun: true,
      },
      artifactHints: {
        recentReadArtifacts: [
          {
            path: 'src/previous.ts',
            artifact: {
              handle: 's8p://artifact/recent-read-research-1',
              mimeType: 'text/plain',
              sha256: 'research',
              size: 123,
            },
          },
        ],
      },
      context: {
        primaryFile: 'src/index.ts',
        primaryText: 'export const answer = 42;',
        contextHash: 'ctx-hash',
      },
      contextResult: {
        prompt: 'ASSEMBLED_CONTEXT',
        meta: {
          contextHash: 'ctx-meta-hash',
        },
      },
      workspace: {
        workPath: '/tmp/test',
        strategy: 'worktree',
      },
      emit: mock(),
    };

    const out = await generateResearch(ctx);

    const lastUserMessage = captured[0][captured[0].length - 1];
    expect(lastUserMessage.role).toBe('user');
    expect(lastUserMessage.content).toContain('s8p://artifact/recent-read-research-1');
    expect(lastUserMessage.content).toContain('src/previous.ts');
    expect(lastUserMessage.content).toContain('artifact.read');
    expect(out.researchText).toBe('research summary');
  });

  it('forwards runtime contextSnapshot into tool-calling execution context', async () => {
    let receivedRuntimeContext: any;

    const llm = {
      getCapabilities: () => ({ toolCalling: true }),
      chat: mock(),
      createPlan: mock(),
      createPatch: mock(),
    };

    spyOn(session, 'chatWithTools').mockImplementation(
      async (_messages: any, _options: any, toolSession: any) => {
        receivedRuntimeContext = toolSession.runtime;
        return {
          role: 'assistant' as const,
          content: JSON.stringify({
            researchNotes: ['note'],
            researchFindings: [{ summary: 'finding' }],
            sources: [{ toolName: 'web.search', summary: 'source', ok: true, timestamp: Date.now() }],
            researchText: 'research summary',
          }),
        } as any;
      },
    );

    const ctx: any = {
      options: {
        llm,
        instruction: 'collect evidence',
        dryRun: true,
        conversationContext: [{ role: 'assistant', content: 'prior context' }],
      },
      toolstack: {
        registry: {
          listAll: () => [],
        },
        policy: {
          decide: () => ({ allowed: false }),
        },
        router: {
          call: mock(async () => ({ status: 'ok' })),
        },
      },
      artifactHints: {
        verifyArtifact: {
          handle: 's8p://artifact/verify-research-1',
          mimeType: 'text/plain',
          sha256: 'verify',
          size: 12,
        },
      },
      toolCallingAudit: [
        {
          timestamp: new Date().toISOString(),
          phase: 'EXPLORE',
          round: 0,
          callId: 'call-explore',
          toolName: 'fs.read',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        },
      ],
      planRuntime: { sessionId: 'plan-research-1', planPathHint: '.salmonloop/plan.md' },
      context: {
        primaryFile: 'src/index.ts',
        primaryText: 'export const answer = 42;',
      },
      contextResult: {
        prompt: 'ASSEMBLED_CONTEXT',
        meta: {
          contextHash: 'ctx-research',
        },
      },
      workspace: {
        workPath: '/tmp/test',
        strategy: 'worktree',
      },
      emit: mock(),
    };

    const out = await generateResearch(ctx);

    expect(out.researchText).toBe('research summary');
    expect(receivedRuntimeContext?.phase).toBe(Phase.RESEARCH);
    expect(receivedRuntimeContext?.contextSnapshot).toEqual({
      conversationContext: ctx.options.conversationContext,
      artifactHints: ctx.artifactHints,
      toolCallingAudit: ctx.toolCallingAudit,
      planRuntime: ctx.planRuntime,
      cacheSharing: {
        namespace: 'research',
        contextHash: 'ctx-research',
      },
    });
  });
});
