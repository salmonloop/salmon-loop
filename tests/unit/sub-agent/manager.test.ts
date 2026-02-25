const { setupMock, teardownMock, registryGetMock, isStopRequestedMock } = (() => ({
  setupMock: mock(),
  teardownMock: mock(),
  registryGetMock: mock(),
  isStopRequestedMock: mock(),
}))();

mock.module('../../../src/core/strata/runtime/environment.js', () => ({
  RuntimeEnvironment: mock().mockImplementation(() => ({
    setup: setupMock,
    teardown: teardownMock,
  })),
}));

mock.module('../../../src/core/sub-agent/registry.js', () => ({
  SubAgentRegistry: {
    get: registryGetMock,
  },
}));

mock.module('../../../src/core/sub-agent/controller.js', () => ({
  SubAgentController: {
    registerAgent: mock(),
    isStopRequested: isStopRequestedMock,
    appendLog: mock(),
    updateStatus: mock(),
  },
}));

mock.module('../../../src/core/observability/logger.js', () => ({
  logger: {
    info: mock(),
    debug: mock(),
    error: mock(),
    warn: mock(),
  },
}));

import { SubAgentManager } from '../../../src/core/sub-agent/core/manager.js';

describe('SubAgentManager setup cleanup', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    registryGetMock.mockReturnValue({
      id: 'surgeon',
      name: 'Surgeon',
      role: 'Coder',
      description: 'test',
      allowedTools: [],
      readOnly: false,
      stratagem: 'surgeon',
      timeoutMs: 1000,
    });
    isStopRequestedMock.mockReturnValue(false);
  });

  it('tears down isolated environment when setup fails', async () => {
    setupMock.mockRejectedValue(new Error('env setup failed'));
    teardownMock.mockResolvedValue(undefined);

    const manager = new SubAgentManager({
      repoRoot: '/repo',
      persistenceRoot: '/repo',
      llm: {
        chat: mock(),
        createPlan: mock(),
        createPatch: mock(),
      },
      dryRun: false,
    } as any);

    const result = await manager.execute({
      agent_ref: 'surgeon',
      task: 'fix bug',
    } as any);

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('LOOP_CRASH');
    expect(teardownMock).toHaveBeenCalledTimes(1);
  });
});
