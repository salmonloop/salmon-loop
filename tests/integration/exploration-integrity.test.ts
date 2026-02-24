import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';

import { runSalmonLoop } from '../../src/core/runtime/loop.js';
import { text } from '../../src/locales/index.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

type TestLlmPhase = 'explore_no_read' | 'explore_with_read' | 'plan' | 'patch' | 'done';

describe('Exploration Integrity Integration', () => {
  const helper = new RealFsTestHelper();
  let repoPath: string;

  const mockLlm = {
    chat: vi.fn(),
    createPlan: vi.fn(),
    createPatch: vi.fn(),
    getModelId: () => 'test-model',
    getCapabilities: () => ({ toolCalling: true, streaming: true }),
  };

  beforeEach(async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        // Keep runtime artifacts out of git dirty checks across retries.
        { path: '.gitignore', content: '.salmonloop/\n' },
        { path: 'README.md', content: 'Original Content' },
        { path: 'src/main.ts', content: 'console.log("main");\n' },
      ],
    });
    repoPath = repo.path;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('[P0] should fail first explore attempt (no read), then retry and succeed after fs.read', async () => {
    const state: {
      phase: TestLlmPhase;
    } = {
      phase: 'explore_no_read',
    };

    mockLlm.chat.mockImplementation(
      async (messages: any[], options?: { responseFormat?: string }) => {
        const hasToolResult = (toolCallId: string) =>
          messages.some((m) => m.role === 'tool' && m.tool_call_id === toolCallId);

        if (state.phase === 'explore_no_read') {
          if (!hasToolResult('explore_search_1')) {
            return {
              role: 'assistant',
              content: 'Searching for relevant files.',
              tool_calls: [
                {
                  id: 'explore_search_1',
                  type: 'function',
                  function: {
                    name: 'code.search',
                    arguments: JSON.stringify({ pattern: 'main' }),
                  },
                },
              ],
            };
          }

          state.phase = 'explore_with_read';
          return {
            role: 'assistant',
            content: 'Exploration complete without reading files.',
            tool_calls: [],
          };
        }

        if (state.phase === 'explore_with_read') {
          if (!hasToolResult('explore_read_1')) {
            return {
              role: 'assistant',
              content: 'Reading target file.',
              tool_calls: [
                {
                  id: 'explore_read_1',
                  type: 'function',
                  function: {
                    name: 'fs.read',
                    arguments: JSON.stringify({ file: 'src/main.ts' }),
                  },
                },
              ],
            };
          }

          state.phase = 'plan';
          return {
            role: 'assistant',
            content: 'Exploration finished with real file content.',
            tool_calls: [],
          };
        }

        if (state.phase === 'plan') {
          if (options?.responseFormat !== 'json_object') {
            return { role: 'assistant', content: '', tool_calls: [] };
          }
          state.phase = 'patch';
          return {
            role: 'assistant',
            content: JSON.stringify({
              goal: 'Update main',
              files: ['src/main.ts'],
              changes: ['Update log'],
              verify: 'ls',
            }),
            tool_calls: [],
          };
        }

        if (state.phase === 'patch') {
          state.phase = 'done';
          return {
            role: 'assistant',
            content:
              'diff --git a/src/main.ts b/src/main.ts\n' +
              '--- a/src/main.ts\n' +
              '+++ b/src/main.ts\n' +
              '@@ -1,1 +1,1 @@\n' +
              '-console.log("main");\n' +
              '+console.log("updated");',
            tool_calls: [],
          };
        }

        return { role: 'assistant', content: 'Ready.', tool_calls: [] };
      },
    );

    const result = await runSalmonLoop({
      instruction: 'Update main',
      repoPath,
      llm: mockLlm as any,
      forceReset: true,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(2);
    expect(result.history?.[0]?.error).toContain(text.errors.technicalDetailsHidden);

    const content = await helper.readFile(repoPath, 'src/main.ts');
    expect(content).toContain('updated');
  });
});
