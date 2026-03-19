import { describe, expect, it, mock } from 'bun:test';

import type { LLM } from '../../../../../src/core/types/index.js';

let applyCheckOk = true;

mock.module('../../../../../src/core/adapters/git/git-adapter.js', () => {
  class GitAdapter {
    constructor() {}
    async execMeta() {
      if (!applyCheckOk) return { ok: false, stderr: 'error: patch does not apply' };
      return { ok: true, stderr: '' };
    }
  }
  return { GitAdapter };
});

mock.module('../../../../../src/core/prompts/runtime.js', () => ({
  getPatchPrompt: async () => 'PATCH_PROMPT',
  getPatchSystemPrompt: async () => 'PATCH_SYSTEM_PROMPT',
}));

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

describe('PATCH (tool calling path) applicability repair', () => {
  function createCtx(llm: LLM): any {
    return {
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
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
  }

  it('salvages once from existing assistant content and enforces canonical diff header', async () => {
    applyCheckOk = true;
    const { generatePatch } = await import('../../../../../src/core/grizzco/steps/patch.js');

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => ({
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'bun -e "process.exit(0)"',
      })),
      createPatch: mock(async () => ''),
      chat: mock().mockResolvedValueOnce({
        role: 'assistant' as const,
        content:
          'first_try\n' +
          '--- a/src/index.js\n' +
          '+++ b/src/index.js\n' +
          '@@ -1,1 +1,1 @@\n' +
          '-const x = 0;\n' +
          '+const x = 1;\n' +
          '\n' +
          'diff --git a/src/index.js b/src/index.js\n' +
          '--- a/src/index.js\n' +
          '+++ b/src/index.js\n' +
          '@@ -1,1 +1,1 @@\n' +
          '-const x = 0;\n' +
          '+const x = 1;\n',
      }),
    };

    const out = await generatePatch(createCtx(llm));
    expect(out.diff.startsWith('diff --git a/src/index.js b/src/index.js')).toBe(true);
    expect((llm.chat as any).mock.calls.length).toBe(1);
  });

  it('fails closed with LLM_PATCH_NOT_UNIFIED_DIFF when no canonical diff exists', async () => {
    applyCheckOk = true;
    const { generatePatch } = await import('../../../../../src/core/grizzco/steps/patch.js');

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => ({
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'bun -e "process.exit(0)"',
      })),
      createPatch: mock(async () => ''),
      chat: mock().mockResolvedValueOnce({
        role: 'assistant' as const,
        content:
          '--- a/src/index.js\n' +
          '+++ b/src/index.js\n' +
          '@@ -1,1 +1,1 @@\n' +
          '-const x = 0;\n' +
          '+const x = 1;\n',
      }),
    };

    await expect(generatePatch(createCtx(llm))).rejects.toMatchObject({
      llmCode: 'LLM_PATCH_NOT_UNIFIED_DIFF',
    });
    expect((llm.chat as any).mock.calls.length).toBe(1);
  });

  it('salvages when the assistant returns an empty patch response', async () => {
    applyCheckOk = true;
    const { generatePatch } = await import('../../../../../src/core/grizzco/steps/patch.js');

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => ({
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'bun -e "process.exit(0)"',
      })),
      createPatch: mock(async () => ''),
      chat: mock().mockResolvedValueOnce({
        role: 'assistant' as const,
        content:
          'diff --git a/src/index.js b/src/index.js\n' +
          '--- a/src/index.js\n' +
          '+++ b/src/index.js\n' +
          '@@ -1,1 +1,1 @@\n' +
          '-const x = 0;\n' +
          '+const x = 1;\n',
      }),
    };

    const out = await generatePatch(createCtx(llm));
    expect(out.diff.startsWith('diff --git a/src/index.js b/src/index.js')).toBe(true);
  });

  it('does not run an additional repair attempt when git apply check fails', async () => {
    applyCheckOk = false;
    const { generatePatch } = await import('../../../../../src/core/grizzco/steps/patch.js');

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => ({
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'bun -e "process.exit(0)"',
      })),
      createPatch: mock(async () => ''),
      chat: mock().mockResolvedValueOnce({
        role: 'assistant' as const,
        content:
          'diff --git a/src/index.js b/src/index.js\n' +
          '--- a/src/index.js\n' +
          '+++ b/src/index.js\n' +
          '@@ -1,1 +1,1 @@\n' +
          '-const x = 0;\n' +
          '+const x = 1;\n',
      }),
    };

    const out = await generatePatch(createCtx(llm));
    expect(out.diff.startsWith('diff --git a/src/index.js b/src/index.js')).toBe(true);
    expect((llm.chat as any).mock.calls.length).toBe(1);
  });

  it('accepts multi-file diffs with /dev/null and no index lines', async () => {
    applyCheckOk = true;
    const { generatePatch } = await import('../../../../../src/core/grizzco/steps/patch.js');

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => ({
        goal: 'test-goal',
        files: ['src/index.js', 'src/new.ts'],
        changes: ['Add a comment', 'Add a new file'],
        verify: 'bun -e "process.exit(0)"',
      })),
      createPatch: mock(async () => ''),
      chat: mock().mockResolvedValueOnce({
        role: 'assistant' as const,
        content:
          'diff --git a/src/index.js b/src/index.js\n' +
          '--- a/src/index.js\n' +
          '+++ b/src/index.js\n' +
          '@@ -1,1 +1,1 @@\n' +
          '-const x = 0;\n' +
          '+const x = 1;\n' +
          'diff --git a/src/new.ts b/src/new.ts\n' +
          'new file mode 100644\n' +
          '--- /dev/null\n' +
          '+++ b/src/new.ts\n' +
          '@@ -0,0 +1,1 @@\n' +
          '+export const value = 1;\n',
      }),
    };

    const out = await generatePatch(createCtx(llm));
    expect(out.diff.startsWith('diff --git a/src/index.js b/src/index.js')).toBe(true);
    expect(out.changedFiles.length).toBe(2);
  });
});
