import { readFile } from 'fs/promises';
import path from 'path';

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { runSalmonLoop } from '../../src/core/runtime/loop.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

type TestPhase = 'explore' | 'plan' | 'patch' | 'done';

describe('Plan toolcalling flow (integration)', () => {
  const helper = new RealFsTestHelper();
  let repoPath: string;

  const mockLlm = {
    chat: mock(),
    createPlan: mock(),
    createPatch: mock(),
    getModelId: () => 'test-model',
    getCapabilities: () => ({ toolCalling: true }),
  };

  beforeEach(async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'README.md', content: 'Original Content' },
        { path: 'src/main.ts', content: 'console.log("main");\n' },
      ],
    });
    repoPath = repo.path;
    mock.clearAllMocks();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('hosts a runtime plan and LLM can plan.read/plan.update during PLAN', async () => {
    const state: {
      phase: TestPhase;
      sessionId?: string;
      baseHash?: string;
      stepId?: string;
    } = { phase: 'explore' };

    mockLlm.chat.mockImplementation(
      async (messages: any[], options?: { responseFormat?: string }) => {
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
            expect(system).toContain('Runtime Plan (Local, gitignored)');
            const m = String(system).match(/Session ID:\s*([a-f0-9]{16})/i);
            expect(m?.[1]).toBeTruthy();
            state.sessionId = m![1];
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

          if (options?.responseFormat !== 'json_object') {
            return { role: 'assistant', content: '', tool_calls: [] };
          }

          state.phase = 'patch';
          return {
            role: 'assistant',
            content: JSON.stringify({
              goal: 'No-op change (dry run)',
              files: ['src/main.ts'],
              changes: ['No-op'],
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
    const result = await runSalmonLoop({
      instruction: 'Test plan toolcalling integration',
      repoPath,
      llm: mockLlm as any,
      dryRun: true,
      forceReset: true,
      onEvent: (event) => events.push(event),
    });

    expect(result.success).toBe(true);
    expect(state.sessionId).toBeTruthy();

    expect(result.auditPath).toBeTruthy();
    const auditRaw = await readFile(result.auditPath!, 'utf-8');
    const audit = JSON.parse(auditRaw) as any;
    const eventsRef = audit?.context?.eventsRef as { path?: string } | undefined;
    expect(typeof eventsRef?.path).toBe('string');
    const eventsPath = path.isAbsolute(eventsRef!.path!)
      ? eventsRef!.path!
      : path.join(path.dirname(result.auditPath!), eventsRef!.path!);
    const eventsRaw = await readFile(eventsPath, 'utf-8');
    const eventsFromAudit = eventsRaw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
    expect(eventsFromAudit.some((e) => e?.action === 'plan.runtime.init')).toBe(true);

    expect(
      events.some(
        (e) =>
          e?.type === 'plan.runtime.ready' &&
          e?.sessionId === state.sessionId &&
          typeof e?.planPathHint === 'string',
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e?.type === 'plan.runtime.journal' && e?.phase === 'PLAN' && e?.ok === true,
      ),
    ).toBe(true);
    expect(events.some((e) => e?.type === 'tool.call.start' && e?.toolName === 'plan.read')).toBe(
      true,
    );
    expect(events.some((e) => e?.type === 'tool.call.end' && e?.toolName === 'plan.update')).toBe(
      true,
    );

    const planPath = path.join(
      repoPath,
      '.salmonloop',
      'plans',
      state.sessionId!,
      'SALMONLOOP_PLAN.md',
    );
    const planText = await helper.readFile(repoPath, path.relative(repoPath, planPath));
    expect(planText).toContain('LLM-updated task');

    const exclude = await helper.readFile(repoPath, path.join('.git', 'info', 'exclude'));
    expect(exclude).toContain('.salmonloop/');
  });
});
