let capturedSession: any;

vi.mock('../../src/core/grizzco/dsl/llm-strategy.js', async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    resolveLlmToolCallingPolicy: () => ({ enabled: true, maxRounds: 1 }),
  };
});

vi.mock('../../src/core/tools/session.js', () => {
  return {
    chatWithTools: vi.fn(async (_messages: any, _chatOptions: any, session: any) => {
      capturedSession = session;
      return {
        role: 'assistant',
        content: JSON.stringify({
          goal: 'test-goal',
          files: ['src/index.js'],
          changes: ['Add a comment'],
          verify: 'node -e "process.exit(0)"',
        }),
      };
    }),
    chatWithToolsStreaming: vi.fn(async (_messages: any, _chatOptions: any, session: any) => {
      capturedSession = session;
      return {
        role: 'assistant',
        content: JSON.stringify({
          goal: 'test-goal',
          files: ['src/index.js'],
          changes: ['Add a comment'],
          verify: 'node -e "process.exit(0)"',
        }),
      };
    }),
  };
});

function createEmptyToolstack(): any {
  return {
    registry: { listAll: () => [] },
    policy: { decide: () => ({ allowed: false }) },
    router: { call: async () => ({ status: 'ok' }) },
  };
}

describe('Grizzco step maxRounds wiring', () => {
  it('forwards policy.maxRounds into chatWithTools session options', async () => {
    const { generatePlan } = await import('../../src/core/grizzco/steps/plan.js');

    const llm: any = {
      getModelId: () => 'test-model',
      createPlan: vi.fn(async () => {
        throw new Error('createPlan should not be called when tool calling is enabled');
      }),
      createPatch: vi.fn(async () => ''),
      chat: vi.fn(async () => ({ role: 'assistant', content: '' })),
    };

    const ctx: any = {
      workspace: { workPath: 'C:\\repo', strategy: 'worktree' },
      options: { llm, instruction: 'test', dryRun: true },
      context: { primaryFile: 'src/index.js', primaryText: 'const x = 1;' },
      emit: () => {},
      toolstack: createEmptyToolstack(),
    };

    await generatePlan(ctx);
    expect(capturedSession?.maxRounds).toBe(1);
  });
});
