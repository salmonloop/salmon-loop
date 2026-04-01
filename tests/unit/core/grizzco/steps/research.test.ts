import { describe, expect, it, mock } from 'bun:test';

import { generateResearch } from '../../../../../src/core/grizzco/steps/research.js';

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
});
