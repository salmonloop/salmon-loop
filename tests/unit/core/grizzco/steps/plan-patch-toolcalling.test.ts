import { generatePatch } from '../../../../../src/core/grizzco/steps/patch.js';
import { generatePlan } from '../../../../../src/core/grizzco/steps/plan.js';
import type { LLM } from '../../../../../src/core/types/index.js';
import { RealFsTestHelper } from '../../../../helpers/real-fs-helper.js';

const helper = new RealFsTestHelper();

afterEach(async () => {
  await helper.cleanup();
});

function createEmptyToolstack(): any {
  return {
    registry: {
      listAll: () => [],
    },
    policy: {
      decide: () => ({ allowed: false }),
    },
    router: {
      call: async () => {
        throw new Error('Tool router should not be called when no tools are registered');
      },
    },
  };
}

describe('Grizzco steps: PLAN/PATCH tool calling path', () => {
  it('PLAN uses the tool-calling chat path when toolstack exists and LLM declares toolCalling capability', async () => {
    const createPlan = mock(async () => {
      throw new Error('createPlan should not be called when tool calling is enabled');
    });

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan,
      createPatch: mock(async () => ''),
      chat: mock(async () => ({
        role: 'assistant' as const,
        content: JSON.stringify({
          goal: 'test-goal',
          files: ['src/index.js'],
          changes: ['Add a comment'],
          verify: 'bun -e "process.exit(0)"',
        }),
      })),
    };

    const ctx: any = {
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
      options: { llm, instruction: 'test', dryRun: true },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    const out = await generatePlan(ctx);
    expect(out.plan.goal).toBe('test-goal');
    expect(createPlan).not.toHaveBeenCalled();
  });

  it('PLAN injects conversationContext into message-based prompts when provided', async () => {
    const captured: any[][] = [];
    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => {
        throw new Error('createPlan should not be called when tool calling is enabled');
      }),
      createPatch: mock(async () => ''),
      chat: mock(async (messages: any) => {
        captured.push(messages.map((m: any) => ({ role: m.role, content: m.content })));
        return {
          role: 'assistant' as const,
          content: JSON.stringify({
            goal: 'test-goal',
            files: ['src/index.js'],
            changes: ['Add a comment'],
            verify: 'bun -e "process.exit(0)"',
          }),
        };
      }),
    };

    const ctx: any = {
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
      options: {
        llm,
        instruction: 'test',
        dryRun: true,
        conversationContext: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
        ],
      },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    await generatePlan(ctx);

    const firstCallMessages = captured[0];
    expect(firstCallMessages[0].role).toBe('system');
    expect(firstCallMessages[1]).toEqual({ role: 'user', content: 'previous question' });
    expect(firstCallMessages[2]).toEqual({ role: 'assistant', content: 'previous answer' });
    expect(firstCallMessages[firstCallMessages.length - 1].role).toBe('user');
  });

  it('PLAN repairs non-JSON responses with a second pass (contract enforcement)', async () => {
    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => {
        throw new Error('createPlan should not be called when tool calling is enabled');
      }),
      createPatch: mock(async () => ''),
      chat: mock()
        .mockResolvedValueOnce({ role: 'assistant' as const, content: 'not json' })
        .mockResolvedValueOnce({
          role: 'assistant' as const,
          content: JSON.stringify({
            goal: 'repaired-goal',
            files: ['src/index.js'],
            changes: ['Repair JSON output'],
            verify: 'bun -e "process.exit(0)"',
          }),
        }),
    };

    const ctx: any = {
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
      options: { llm, instruction: 'test', dryRun: true },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    const out = await generatePlan(ctx);
    expect(out.plan.goal).toBe('repaired-goal');
  });

  it('PATCH uses the tool-calling chat path when toolstack exists and LLM declares toolCalling capability', async () => {
    const createPatch = mock(async () => {
      throw new Error('createPatch should not be called when tool calling is enabled');
    });

    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/index.js', content: 'const x = 1;\n' }],
    });

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => ({
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'bun -e "process.exit(0)"',
      })),
      createPatch,
      chat: mock(async () => ({
        role: 'assistant' as const,
        content:
          'diff --git a/src/index.js b/src/index.js\n' +
          'index 1111111..2222222 100644\n' +
          '--- a/src/index.js\n' +
          '+++ b/src/index.js\n' +
          '@@ -1,1 +1,2 @@\n' +
          '+// test\n' +
          ' const x = 1;\n',
      })),
    };

    const ctx: any = {
      workspace: { workPath: repo.path, strategy: 'worktree' },
      options: { llm, instruction: 'test', dryRun: true },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      plan: {
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'bun -e "process.exit(0)"',
      },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    const out = await generatePatch(ctx);
    expect(out.changedFiles).toEqual(['src/index.js']);
    expect(out.diff).toContain('diff --git a/src/index.js b/src/index.js');
    expect(createPatch).not.toHaveBeenCalled();
  });

  it('PATCH repairs empty/non-diff responses with a second pass (contract enforcement)', async () => {
    const createPatch = mock(async () => {
      throw new Error('createPatch should not be called when tool calling is enabled');
    });

    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/index.js', content: 'const x = 1;\n' }],
    });

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => ({
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'bun -e "process.exit(0)"',
      })),
      createPatch,
      chat: mock()
        .mockResolvedValueOnce({ role: 'assistant' as const, content: '' })
        .mockResolvedValueOnce({
          role: 'assistant' as const,
          content:
            'diff --git a/src/index.js b/src/index.js\n' +
            'index 1111111..2222222 100644\n' +
            '--- a/src/index.js\n' +
            '+++ b/src/index.js\n' +
            '@@ -1,1 +1,2 @@\n' +
            '+// repaired\n' +
            ' const x = 1;\n',
        }),
    };

    const ctx: any = {
      workspace: { workPath: repo.path, strategy: 'worktree' },
      options: { llm, instruction: 'test', dryRun: true },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      plan: {
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'bun -e "process.exit(0)"',
      },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    const out = await generatePatch(ctx);
    expect(out.diff).toContain('diff --git a/src/index.js b/src/index.js');
    expect(out.diff).toContain('+// repaired');
    expect(createPatch).not.toHaveBeenCalled();
  });
});
