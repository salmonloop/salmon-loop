import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { InitCtx } from '../../../src/core/grizzco/engine/pipeline/types.js';
import { createLogger, setLogger } from '../../../src/core/observability/logger.js';
import type { SubAgentProfile } from '../../../src/core/sub-agent/types.js';

const { infoMock, warnMock, debugMock } = (() => ({
  infoMock: mock(),
  warnMock: mock(),
  debugMock: mock(),
}))();

const pipelineStepMock = mock();
const pipelineStepWithRecoveryMock = mock();
const pipelineExecuteMock = mock();
const pipelineOfMock = mock();

const pipelineChain = {
  step: pipelineStepMock,
  stepWithRecovery: pipelineStepWithRecoveryMock,
  execute: pipelineExecuteMock,
};

mock.module('../../../src/core/grizzco/steps/audit.js', () => ({
  saveAudit: mock().mockResolvedValue('/tmp/audit.json'),
}));

mock.module('../../../src/core/grizzco/engine/pipeline/pipeline.js', () => ({
  Pipeline: {
    of: pipelineOfMock,
  },
}));

describe('SmallfryLoop', () => {
  let mockInitCtx: InitCtx;

  const loadSmallfryLoop = async () => {
    const modulePath = `../../../src/core/sub-agent/core/loop.js?smallfry-loop-test=${Date.now()}-${Math.random()}`;
    const loaded = await import(modulePath);
    return loaded.SmallfryLoop;
  };

  afterAll(() => {
    mock.restore();
    setLogger(createLogger({ silent: true }));
  });

  beforeEach(() => {
    setLogger({ info: infoMock, warn: warnMock, debug: debugMock } as any);
    infoMock.mockReset();
    warnMock.mockReset();
    debugMock.mockReset();
    mock.clearAllMocks();

    pipelineStepMock.mockReturnValue(pipelineChain);
    pipelineStepWithRecoveryMock.mockReturnValue(pipelineChain);
    pipelineExecuteMock.mockResolvedValue({
      success: true,
      traces: [],
      data: { reason: 'Success', attempt: 1 },
    });
    pipelineOfMock.mockReturnValue(pipelineChain);

    const mockLlm = {
      chat: mock(),
      createPlan: mock(),
      createPatch: mock(),
    };
    mockInitCtx = {
      workspace: { workPath: '/tmp/repo', baseRepoPath: '/tmp/repo', strategy: 'direct' },
      options: { instruction: 'test', repoPath: '/tmp/repo', llm: mockLlm },
      mode: 'patch',
      fs: {
        readFile: mock(),
        writeFile: mock(),
        exists: mock(),
        mkdir: mock(),
      },
      emit: mock(),
      fileStateResolver: {} as any,
      shadowInitialRef: 'HEAD',
    };
  });

  it('should only run PLAN for investigator profile', async () => {
    const SmallfryLoop = await loadSmallfryLoop();

    const profile: SubAgentProfile = {
      id: 'explorer',
      name: 'Explorer',
      role: 'Explorer',
      description: 'Test',
      allowedTools: [],
      readOnly: true,
      stratagem: 'investigator',
    };

    const loop = new SmallfryLoop(profile);
    await loop.execute(mockInitCtx);

    expect(infoMock).not.toHaveBeenCalled();
    expect(debugMock).toHaveBeenCalledWith(expect.stringContaining('[SmallfryLoop]'));
    expect(pipelineStepMock).toHaveBeenCalledWith('PLAN', expect.any(Function));
    expect(pipelineStepMock).not.toHaveBeenCalledWith('PATCH', expect.any(Function));
    expect(pipelineStepWithRecoveryMock).not.toHaveBeenCalled();
  });

  it('should run PATCH for surgeon profile', async () => {
    const SmallfryLoop = await loadSmallfryLoop();

    const profile: SubAgentProfile = {
      id: 'surgeon',
      name: 'Surgeon',
      role: 'Coder',
      description: 'Test',
      allowedTools: [],
      readOnly: false,
      stratagem: 'surgeon',
    };

    const loop = new SmallfryLoop(profile);
    await loop.execute(mockInitCtx);

    expect(pipelineStepMock).toHaveBeenCalledWith('PATCH', expect.any(Function));
    expect(pipelineStepWithRecoveryMock).not.toHaveBeenCalled();
  });

  it('should report failure if budget is exceeded', async () => {
    const SmallfryLoop = await loadSmallfryLoop();

    const profile: SubAgentProfile = {
      id: 'surgeon',
      name: 'Surgeon',
      role: 'Coder',
      description: 'Test',
      allowedTools: [],
      readOnly: false,
      stratagem: 'surgeon',
      maxTokens: 100,
    };

    pipelineExecuteMock.mockResolvedValueOnce({
      success: true,
      duration: 0,
      traces: [
        {
          name: 'PLAN',
          metadata: { usage: { prompt_tokens: 150, completion_tokens: 50 } },
          start: 0,
          end: 0,
          duration: 0,
        },
      ],
      data: { reason: 'Step success' } as any,
    });

    const loop = new SmallfryLoop(profile);
    const result = await loop.execute(mockInitCtx);

    expect(result.success).toBe(false);
    expect(result.summary).toContain('Token budget exceeded');
  });
});
