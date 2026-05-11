import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const { setupMock, teardownMock, registryGetMock, isStopRequestedMock } = (() => ({
  setupMock: mock(),
  teardownMock: mock(),
  registryGetMock: mock(),
  isStopRequestedMock: mock(),
}))();

const { infoMock, debugMock, errorMock, warnMock } = (() => ({
  infoMock: mock(),
  debugMock: mock(),
  errorMock: mock(),
  warnMock: mock(),
}))();

import { clearLogger, setLogger } from '../../../src/core/observability/logger.js';
import { SubAgentManager } from '../../../src/core/sub-agent/core/manager.js';

describe('SubAgentManager setup cleanup', () => {
  afterAll(() => {
    mock.restore();
    clearLogger();
  });

  beforeEach(() => {
    setLogger({ info: infoMock, debug: debugMock, error: errorMock, warn: warnMock } as any);
    infoMock.mockReset();
    debugMock.mockReset();
    errorMock.mockReset();
    warnMock.mockReset();

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

    const deps = {
      registry: { get: registryGetMock },
      createRuntimeEnvironment: () =>
        ({
          setup: setupMock,
          teardown: teardownMock,
        }) as any,
    };

    const controller = {
      registerAgent: mock(),
      isStopRequested: isStopRequestedMock,
      appendLog: mock(),
      updateStatus: mock(),
      listAgents: mock(() => []),
      getAgent: mock(() => undefined),
      tailLogs: mock(() => []),
      requestStop: mock(() => true),
    };

    const manager = new SubAgentManager(
      {
        repoRoot: '/repo',
        persistenceRoot: '/repo',
        llm: {
          chat: mock(),
          createPlan: mock(),
          createPatch: mock(),
        },
        dryRun: false,
      } as any,
      controller as any,
      deps as any,
    );

    const result = await manager.execute({
      agent_ref: 'surgeon',
      task: 'fix bug',
    } as any);

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('LOOP_CRASH');
    expect(teardownMock).toHaveBeenCalledTimes(1);
  });
});
