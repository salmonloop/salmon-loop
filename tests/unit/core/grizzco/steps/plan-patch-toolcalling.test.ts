import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { generatePatch } from '../../../../../src/core/grizzco/steps/patch.js';
import { generatePlan } from '../../../../../src/core/grizzco/steps/plan.js';
import {
  clearPromptRegistry,
  createPromptRegistry,
  setPromptRegistry,
} from '../../../../../src/core/prompts/registry.js';
import { planUpdateSpec } from '../../../../../src/core/tools/builtin/plan.js';
import type { LLM } from '../../../../../src/core/types/index.js';
import { RealFsTestHelper } from '../../../../helpers/real-fs-helper.js';

const helper = new RealFsTestHelper();

beforeEach(() => {
  setPromptRegistry(createPromptRegistry());
});

afterEach(async () => {
  clearPromptRegistry();
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

function createPlanUpdateToolstack(routerCall: (envelope: any) => Promise<any>): any {
  return {
    registry: {
      listAll: () => [planUpdateSpec],
    },
    policy: {
      decide: () => ({ allowed: true }),
    },
    router: {
      call: routerCall,
      getSpec: () => planUpdateSpec,
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

  it('PLAN coerces stringified plan.update patch objects and audits the coercion', async () => {
    let receivedArgs: any;
    const routerCall = mock(async (envelope: any) => {
      receivedArgs = envelope.args;
      return {
        id: envelope.id,
        toolName: envelope.toolName,
        source: 'builtin',
        status: 'ok',
        output: {
          ok: true,
          sessionId: envelope.args.sessionId,
          baseHash: envelope.args.baseHash,
          updatedStepId: envelope.args.stepId,
        },
        summary: 'ok',
        outputSummary: 'ok',
        durationMs: 1,
      };
    });

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => {
        throw new Error('createPlan should not be called when tool calling is enabled');
      }),
      createPatch: mock(async () => ''),
      chat: mock()
        .mockResolvedValueOnce({
          role: 'assistant' as const,
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'plan.update',
                arguments: JSON.stringify({
                  sessionId: 'sess_123',
                  baseHash: 'deadbeef00',
                  stepId: 'work_root',
                  patch: '{"status":"active","note":"Track regression"}',
                }),
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          role: 'assistant' as const,
          content: JSON.stringify({
            goal: 'test-goal',
            files: ['src/index.js'],
            changes: ['Add a comment'],
            verify: 'bun -e "process.exit(0)"',
          }),
        }),
    };

    const ctx: any = {
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
      options: { llm, instruction: 'test', dryRun: true },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      emit: () => {},
      toolstack: createPlanUpdateToolstack(routerCall),
    };

    await generatePlan(ctx);

    expect(routerCall).toHaveBeenCalledTimes(1);
    expect(receivedArgs.patch).toEqual({ status: 'active', note: 'Track regression' });
    const auditEntries = ctx.toolCallingAudit as any[] | undefined;
    expect(
      auditEntries?.some(
        (entry) => entry.toolName === 'plan.update' && entry.coercedPatchSource === 'stringified',
      ),
    ).toBe(true);
  });

  it('PLAN returns INVALID_INPUT with patch-specific guidance for non-object patch strings', async () => {
    const routerCall = mock(async () => {
      throw new Error('router should not be called for invalid patch input');
    });
    const capturedMessages: any[][] = [];

    const llm: LLM = {
      getCapabilities: () => ({ toolCalling: true }),
      createPlan: mock(async () => {
        throw new Error('createPlan should not be called when tool calling is enabled');
      }),
      createPatch: mock(async () => ''),
      chat: mock(async (messages: any) => {
        capturedMessages.push(messages);
        if (capturedMessages.length === 1) {
          return {
            role: 'assistant' as const,
            content: '',
            tool_calls: [
              {
                id: 'call-2',
                type: 'function',
                function: {
                  name: 'plan.update',
                  arguments: JSON.stringify({
                    sessionId: 'sess_456',
                    baseHash: 'beadfeed11',
                    stepId: 'work_root',
                    patch: '["not", "an", "object"]',
                  }),
                },
              },
            ],
          };
        }
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
      options: { llm, instruction: 'test', dryRun: true },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      emit: () => {},
      toolstack: createPlanUpdateToolstack(routerCall),
    };

    await generatePlan(ctx);

    expect(routerCall).not.toHaveBeenCalled();
    const toolMessage = capturedMessages[1]?.find((m: any) => m.role === 'tool');
    const payload = JSON.parse(toolMessage.content);
    expect(payload.error.code).toBe('INVALID_INPUT');
    expect(payload.error.message).toContain('Invalid field: patch');
    expect(payload.error.message).toContain('Expected object');
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

  it('PLAN preserves summary system messages from conversationContext', async () => {
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
          { role: 'system', content: '[Previous conversation summary]\nSummary body' },
          { role: 'user', content: 'previous question' },
        ],
      },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    await generatePlan(ctx);

    const firstCallMessages = captured[0];
    expect(firstCallMessages[0].role).toBe('system');
    expect(firstCallMessages[1]).toEqual({
      role: 'system',
      content: '[Previous conversation summary]\nSummary body',
    });
    expect(firstCallMessages[2]).toEqual({ role: 'user', content: 'previous question' });
    expect(firstCallMessages[firstCallMessages.length - 1].role).toBe('user');
  });

  it('PLAN prefers the assembler-produced context prompt from contextResult', async () => {
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
            changes: ['Use assembled context'],
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
      },
      context: { primaryFile: 'src/index.js', primaryText: 'LIVE_CONTEXT_SHOULD_NOT_BE_USED' },
      contextResult: {
        prompt: 'ASSEMBLED_CONTEXT_FROM_CONTEXT_SERVICE',
      },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    await generatePlan(ctx);

    const lastUserMessage = captured[0][captured[0].length - 1];
    expect(lastUserMessage.role).toBe('user');
    expect(lastUserMessage.content).toContain('ASSEMBLED_CONTEXT_FROM_CONTEXT_SERVICE');
    expect(lastUserMessage.content).not.toContain('LIVE_CONTEXT_SHOULD_NOT_BE_USED');
  });

  it('PLAN exposes prior verify artifact handles for artifact-first retry context', async () => {
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
            goal: 'retry-goal',
            files: ['src/index.js'],
            changes: ['Inspect verify artifact'],
            verify: 'bun -e "process.exit(0)"',
          }),
        };
      }),
    };

    const ctx: any = {
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
      options: {
        llm,
        instruction: 'retry after verify failure',
        dryRun: true,
      },
      artifactHints: {
        verifyArtifact: {
          handle: 's8p://artifact/verify-log-123',
          mimeType: 'text/plain',
          sha256: 'abc',
          size: 123,
        },
      },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      contextResult: {
        prompt: 'ASSEMBLED_CONTEXT_FROM_CONTEXT_SERVICE',
        meta: {},
      },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    await generatePlan(ctx);

    const lastUserMessage = captured[0][captured[0].length - 1];
    expect(lastUserMessage.role).toBe('user');
    expect(lastUserMessage.content).toContain('s8p://artifact/verify-log-123');
    expect(lastUserMessage.content).toContain('artifact.read');
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

  it('PATCH fails closed on empty responses and does not attempt a repair pass', async () => {
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
      chat: mock().mockResolvedValueOnce({ role: 'assistant' as const, content: '' }),
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

    await expect(generatePatch(ctx)).rejects.toMatchObject({
      llmCode: 'LLM_PATCH_EMPTY',
    });
    expect(createPatch).not.toHaveBeenCalled();
  });
});
