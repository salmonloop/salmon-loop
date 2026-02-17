import { describe, expect, it, vi } from 'vitest';

import type { LLM } from '../../../../../src/core/types/index.js';

let execCalls = 0;

vi.mock('../../../../../src/core/adapters/git/git-adapter.js', () => {
  class GitAdapter {
    constructor() {}
    async execMeta() {
      execCalls += 1;
      if (execCalls === 1) {
        return { ok: false, stderr: 'error: corrupt patch at line 6' };
      }
      return { ok: true, stderr: '' };
    }
  }
  return { GitAdapter };
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

describe('PATCH (tool calling path) applicability repair', () => {
  it('repairs a unified diff that fails git apply --check', async () => {
    execCalls = 0;
    const { generatePatch } = await import('../../../../../src/core/grizzco/steps/patch.js');

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: vi.fn(async () => ({
        goal: 'test-goal',
        files: ['src/index.js'],
        changes: ['Add a comment'],
        verify: 'node -e "process.exit(0)"',
      })),
      createPatch: vi.fn(async () => ''),
      chat: vi
        .fn()
        .mockResolvedValueOnce({
          role: 'assistant' as const,
          content:
            'diff --git a/src/index.js b/src/index.js\n' +
            '--- a/src/index.js\n' +
            '+++ b/src/index.js\n' +
            '+This line makes git apply unhappy\n',
        })
        .mockResolvedValueOnce({
          role: 'assistant' as const,
          content:
            'diff --git a/src/index.js b/src/index.js\n' +
            '--- a/src/index.js\n' +
            '+++ b/src/index.js\n' +
            '@@ -1,1 +1,2 @@\n' +
            '+// repaired\n' +
            ' const x = 1;\n',
        }),
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
    expect(out.diff).toContain('@@ -1,1 +1,2 @@');
    expect((llm.chat as any).mock.calls.length).toBe(2);
  });
});
