import { beforeEach, describe, expect, it, mock } from 'bun:test';

const hoisted = (() => ({
  chatWithTools: mock(),
  chatWithToolsStreaming: mock(),
  resolveLlmToolCallingPolicy: mock(),
}))();

mock.module('../../../../../src/core/tools/session.js', () => ({
  chatWithTools: hoisted.chatWithTools,
  chatWithToolsStreaming: hoisted.chatWithToolsStreaming,
}));

mock.module('../../../../../src/core/grizzco/dsl/llm-strategy.js', () => ({
  resolveLlmToolCallingPolicy: hoisted.resolveLlmToolCallingPolicy,
}));

describe('runAutopilot', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    hoisted.resolveLlmToolCallingPolicy.mockReturnValue({ enabled: true, maxRounds: 8 });
    hoisted.chatWithTools.mockImplementation(
      async (_messages: any, _chatOptions: any, session: any) => {
        session.toolCallingAudit?.event({
          timestamp: new Date().toISOString(),
          phase: 'AUTOPILOT',
          round: 0,
          callId: 'call-1',
          toolName: 'plan.update',
          toolIntent: 'WRITE',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        });
        return { role: 'assistant', content: 'autopilot with tools' };
      },
    );
    hoisted.chatWithToolsStreaming.mockImplementation(
      async (_messages: any, _chatOptions: any, session: any) => {
        session.toolCallingAudit?.event({
          timestamp: new Date().toISOString(),
          phase: 'AUTOPILOT',
          round: 0,
          callId: 'call-stream',
          toolName: 'plan.update',
          toolIntent: 'WRITE',
          rawArgsType: 'string',
          parsedArgsOk: true,
          toolResultStatus: 'ok',
        });
        return { role: 'assistant', content: 'autopilot with streaming tools' };
      },
    );
  });

  it('uses the shared tool session runtime when tools are available', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');

    const llm = {
      chat: mock(async () => ({ role: 'assistant', content: 'fallback' })),
      getModelId: () => 'gpt-test',
    } as any;

    const result = await runAutopilot({
      options: {
        instruction: 'inspect the repo and act',
        llm,
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'worktree',
      },
      toolstack: {
        registry: { listAll: () => [] },
        policy: { decide: () => ({ allowed: true }) },
        router: {},
      },
      emit: () => {},
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
      artifactHints: {},
      toolCallingAudit: [],
    } as any);

    expect(hoisted.chatWithTools).toHaveBeenCalledTimes(1);
    expect(hoisted.chatWithTools.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        phase: 'AUTOPILOT',
        maxRounds: 8,
      }),
    );
    expect(result.report.summary).toBe('autopilot with tools');
    expect(result.mutated).toBe(true);
    expect(result.toolCallingAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: 'plan.update',
          toolIntent: 'WRITE',
          toolResultStatus: 'ok',
        }),
      ]),
    );
  });

  it('falls back to plain llm chat when tool calling is unavailable', async () => {
    const { runAutopilot } = await import('../../../../../src/core/grizzco/steps/autopilot.js');

    hoisted.resolveLlmToolCallingPolicy.mockReturnValueOnce({ enabled: false, maxRounds: 4 });

    const llm = {
      chat: mock(async () => ({ role: 'assistant', content: 'fallback answer' })),
      getModelId: () => 'gpt-test',
    } as any;

    const emit = mock();
    const result = await runAutopilot({
      options: {
        instruction: 'inspect the repo and act',
        llm,
      },
      workspace: {
        baseRepoPath: '/repo',
        workPath: '/repo',
        strategy: 'direct',
      },
      emit,
      fs: {} as any,
      fileStateResolver: {} as any,
      shadowInitialRef: 'shadow',
    } as any);

    expect(hoisted.chatWithTools).not.toHaveBeenCalled();
    expect(result.report.summary).toBe('fallback answer');
    expect(result.mutated).toBe(false);
  });
});
