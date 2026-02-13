import { generatePatch } from '../../../../../src/core/grizzco/steps/patch.js';
import { generatePlan } from '../../../../../src/core/grizzco/steps/plan.js';
import type { LLM } from '../../../../../src/core/types/index.js';

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
    const createPlan = vi.fn(async () => {
      throw new Error('createPlan should not be called when tool calling is enabled');
    });

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan,
      createPatch: vi.fn(async () => ''),
      chat: vi.fn(async () => ({
        role: 'assistant' as const,
        content: JSON.stringify({
          goal: 'test-goal',
          files: ['src/index.js'],
          changes: ['Add a comment'],
          verify: 'node -e "process.exit(0)"',
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

  it('PATCH uses the tool-calling chat path when toolstack exists and LLM declares toolCalling capability', async () => {
    const createPatch = vi.fn(async () => {
      throw new Error('createPatch should not be called when tool calling is enabled');
    });

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: vi.fn(async () => ({
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'node -e "process.exit(0)"',
      })),
      createPatch,
      chat: vi.fn(async () => ({
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
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
      options: { llm, instruction: 'test', dryRun: true },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      plan: {
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'node -e "process.exit(0)"',
      },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    const out = await generatePatch(ctx);
    expect(out.changedFiles).toEqual(['src/index.js']);
    expect(out.diff).toContain('diff --git a/src/index.js b/src/index.js');
    expect(createPatch).not.toHaveBeenCalled();
  });
});
