import path from 'path';

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

import { hasSuccessfulPlanUpdateDuringPlan } from '../../src/core/grizzco/steps/plan.js';
import { clearLogger, createLogger, setLogger } from '../../src/core/observability/logger.js';
import { runSalmonLoop } from '../../src/core/runtime/loop.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Plan toolcalling flow (integration)', () => {
  const helper = new RealFsTestHelper();
  let repoPath: string;

  beforeEach(async () => {
    setLogger(createLogger({ silent: true }));
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: '.gitignore', content: '.salmonloop/\n' },
        { path: 'README.md', content: 'Original Content' },
        { path: 'src/main.ts', content: 'console.log("main");\n' },
      ],
    });
    repoPath = repo.path;
    mock.restore();
  });

  afterEach(async () => {
    clearLogger();
    await helper.cleanup();
  });

  it('detects successful PLAN plan.update calls from tool-calling audit entries', () => {
    const withSuccess = {
      toolCallingAudit: [
        {
          phase: 'PLAN',
          toolName: 'plan.update',
          callId: 'call-1',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
          toolResultOutputOk: true,
        },
      ],
    } as any;
    expect(hasSuccessfulPlanUpdateDuringPlan(withSuccess)).toBe(true);

    const withFailureOnly = {
      toolCallingAudit: [
        {
          phase: 'PLAN',
          toolName: 'plan.update',
          callId: 'call-2',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
          toolResultOutputOk: false,
        },
      ],
    } as any;
    expect(hasSuccessfulPlanUpdateDuringPlan(withFailureOnly)).toBe(false);
  });

  it('skips host fallback hydration when plan.update succeeds', async () => {
    const state: {
      phase: 'explore' | 'plan' | 'patch' | 'done';
      sessionId?: string;
      baseHash?: string;
      stepId?: string;
    } = { phase: 'explore' };

    const mockLlm = {
      chat: mock(),
      createPlan: mock(),
      createPatch: mock(),
      getModelId: () => 'test-model',
      getCapabilities: () => ({ toolCalling: true }),
    };

    mockLlm.chat.mockImplementation(
      async (messages: any[], _options?: { responseFormat?: string }) => {
        const hasToolResult = (toolCallId: string) =>
          messages.some((m) => m.role === 'tool' && m.tool_call_id === toolCallId);

        const getToolOutput = (toolCallId: string) => {
          const msg = messages.find((m) => m.role === 'tool' && m.tool_call_id === toolCallId);
          if (!msg) return null;
          try {
            const parsed = JSON.parse(msg.content);
            return parsed?.output ?? null;
          } catch {
            return null;
          }
        };

        if (state.phase === 'explore') {
          if (!hasToolResult('explore_read_main')) {
            return {
              role: 'assistant',
              content: 'Reading main file.',
              tool_calls: [
                {
                  id: 'explore_read_main',
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
          return { role: 'assistant', content: 'Exploration complete.', tool_calls: [] };
        }

        if (state.phase === 'plan') {
          const system = messages.find((m) => m.role === 'system')?.content ?? '';
          if (!state.sessionId) {
            const m = String(system).match(/Session ID:\s*([^\s]+)/);
            state.sessionId = m?.[1];
            expect(state.sessionId).toBeTruthy();
          }

          if (!hasToolResult('plan_read_1')) {
            return {
              role: 'assistant',
              content: 'Reading runtime plan.',
              tool_calls: [
                {
                  id: 'plan_read_1',
                  type: 'function',
                  function: {
                    name: 'plan.read',
                    arguments: JSON.stringify({ sessionId: state.sessionId }),
                  },
                },
              ],
            };
          }

          if (!state.baseHash || !state.stepId) {
            const out = getToolOutput('plan_read_1');
            expect(out?.sessionId).toBe(state.sessionId);
            expect(typeof out?.baseHash).toBe('string');
            state.baseHash = out.baseHash;
            expect(out?.active?.length).toBeGreaterThan(0);
            state.stepId = out.active[0].stepId;
          }

          if (!hasToolResult('plan_update_1')) {
            return {
              role: 'assistant',
              content: 'Updating runtime plan.',
              tool_calls: [
                {
                  id: 'plan_update_1',
                  type: 'function',
                  function: {
                    name: 'plan.update',
                    arguments: JSON.stringify({
                      sessionId: state.sessionId,
                      baseHash: state.baseHash,
                      stepId: state.stepId,
                      patch: { appendSubtasks: ['LLM-updated task'], note: 'from PLAN' },
                    }),
                  },
                },
              ],
            };
          }

          state.phase = 'patch';
          return {
            role: 'assistant',
            content: JSON.stringify({
              goal: 'No-op change (dry run)',
              files: ['src/main.ts'],
              changes: ['Host fallback subtask'],
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
              '+console.log("main");\n',
            tool_calls: [],
          };
        }

        return { role: 'assistant', content: 'Ready.', tool_calls: [] };
      },
    );

    const events: any[] = [];
    await runSalmonLoop({
      instruction: 'Test plan toolcalling integration',
      repoPath,
      llm: mockLlm as any,
      dryRun: true,
      forceReset: true,
      onEvent: (event) => events.push(event),
    });

    const runtimeReadyRaw = events.find((event) => event?.type === 'plan.runtime.ready') as
      | { sessionId?: string }
      | undefined;
    expect(runtimeReadyRaw?.sessionId).toBeTruthy();

    const planPath = path.join(
      repoPath,
      '.salmonloop',
      'plans',
      runtimeReadyRaw!.sessionId!,
      'SALMONLOOP_PLAN.md',
    );
    const planText = await helper.readFile(repoPath, path.relative(repoPath, planPath));
    expect(planText).not.toContain('Host fallback subtask');
  });

  it('keeps legacy non-tool PLAN fallback hydration working', async () => {
    const legacyLlm = {
      chat: mock(),
      createPlan: mock(),
      createPatch: mock(),
      getModelId: () => 'test-model',
      getCapabilities: () => ({ toolCalling: false }),
    };

    legacyLlm.createPlan.mockResolvedValue({
      goal: 'Legacy plan output',
      files: ['src/main.ts'],
      changes: ['Legacy fallback subtask'],
      verify: 'ls',
    });
    legacyLlm.createPatch.mockResolvedValue(
      'diff --git a/src/main.ts b/src/main.ts\n' +
        '--- a/src/main.ts\n' +
        '+++ b/src/main.ts\n' +
        '@@ -1,1 +1,1 @@\n' +
        '-console.log("main");\n' +
        '+console.log("main");\n',
    );

    const events: any[] = [];
    await runSalmonLoop({
      instruction: 'Test legacy plan fallback hydration',
      repoPath,
      llm: legacyLlm as any,
      dryRun: true,
      forceReset: true,
      onEvent: (event) => events.push(event),
    });

    const runtimeReadyRaw = events.find((event) => event?.type === 'plan.runtime.ready') as
      | { sessionId?: string }
      | undefined;
    expect(runtimeReadyRaw?.sessionId).toBeTruthy();

    const planPath = path.join(
      repoPath,
      '.salmonloop',
      'plans',
      runtimeReadyRaw!.sessionId!,
      'SALMONLOOP_PLAN.md',
    );
    const planText = await helper.readFile(repoPath, path.relative(repoPath, planPath));
    expect(planText).toContain('Legacy fallback subtask');
  });
});
