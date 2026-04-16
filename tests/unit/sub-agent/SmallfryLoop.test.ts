import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { Pipeline } from '../../../src/core/grizzco/engine/pipeline/pipeline.js';
import { InitCtx } from '../../../src/core/grizzco/engine/pipeline/types.js';
import { clearLogger, setLogger } from '../../../src/core/observability/logger.js';
import { SmallfryLoop } from '../../../src/core/sub-agent/core/loop.js';
import { SubAgentProfile } from '../../../src/core/sub-agent/types.js';

const { infoMock, warnMock, debugMock } = (() => ({
  infoMock: mock(),
  warnMock: mock(),
  debugMock: mock(),
}))();

mock.module('../../../src/core/grizzco/steps/audit.js', () => ({
  saveAudit: mock().mockResolvedValue('/tmp/audit.json'),
}));

mock.module('../../../src/core/grizzco/engine/pipeline/pipeline.js', () => ({
  Pipeline: {
    of: mock().mockReturnValue({
      step: mock().mockReturnThis(),
      stepWithRecovery: mock().mockReturnThis(),
      execute: mock().mockResolvedValue({
        success: true,
        traces: [],
        data: { reason: 'Success', attempt: 1 },
      }),
    }),
  },
}));

describe('SmallfryLoop', () => {
  let mockInitCtx: InitCtx;

  afterAll(() => {
    mock.restore();
    clearLogger();
  });

  beforeEach(() => {
    setLogger({ info: infoMock, warn: warnMock, debug: debugMock } as any);
    infoMock.mockReset();
    warnMock.mockReset();
    debugMock.mockReset();
    mock.restore();
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

    const pipeline = Pipeline.of(mockInitCtx);
    expect(pipeline.step).toHaveBeenCalledWith('PLAN', expect.any(Function));
    // Should NOT call PATCH
    expect(pipeline.step).not.toHaveBeenCalledWith('PATCH', expect.any(Function));
    expect(pipeline.stepWithRecovery).not.toHaveBeenCalled();
  });

  it('should run PATCH for surgeon profile', async () => {
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

    const pipeline = Pipeline.of(mockInitCtx);
    expect(pipeline.step).toHaveBeenCalledWith('PATCH', expect.any(Function));
    expect(pipeline.stepWithRecovery).not.toHaveBeenCalled();
  });

  it('should report failure if budget is exceeded', async () => {
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

    // Mock pipeline to return high token usage in traces
    (Pipeline.of(mockInitCtx).execute as any).mockResolvedValueOnce({
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
