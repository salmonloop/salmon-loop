const { setupMock, teardownMock, registryGetMock, isStopRequestedMock } = (() => ({
  setupMock: vi.fn(),
  teardownMock: vi.fn(),
  registryGetMock: vi.fn(),
  isStopRequestedMock: vi.fn(),
}))();

vi.mock('../../../src/core/strata/runtime/environment.js', () => ({
  RuntimeEnvironment: vi.fn().mockImplementation(() => ({
    setup: setupMock,
    teardown: teardownMock,
  })),
}));

vi.mock('../../../src/core/sub-agent/registry.js', () => ({
  SubAgentRegistry: {
    get: registryGetMock,
  },
}));

vi.mock('../../../src/core/sub-agent/controller.js', () => ({
  SubAgentController: {
    registerAgent: vi.fn(),
    isStopRequested: isStopRequestedMock,
    appendLog: vi.fn(),
    updateStatus: vi.fn(),
  },
}));

vi.mock('../../../src/core/observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { SubAgentManager } from '../../../src/core/sub-agent/core/manager.js';

describe('SubAgentManager setup cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        chat: vi.fn(),
        createPlan: vi.fn(),
        createPatch: vi.fn(),
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
