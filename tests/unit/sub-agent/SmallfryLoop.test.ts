import { describe, it, expect, vi, beforeEach } from 'bun:test';

import { Pipeline } from '../../../src/core/grizzco/engine/pipeline/pipeline.js';
import { InitCtx } from '../../../src/core/grizzco/engine/pipeline/types.js';
import { SmallfryLoop } from '../../../src/core/sub-agent/core/loop.js';
import { SubAgentProfile } from '../../../src/core/sub-agent/types.js';

vi.mock('../../../src/core/grizzco/steps/audit.js', () => ({
  saveAudit: vi.fn().mockResolvedValue('/tmp/audit.json'),
}));

vi.mock('../../../src/core/grizzco/engine/pipeline/pipeline.js', () => ({
  Pipeline: {
    of: vi.fn().mockReturnValue({
      step: vi.fn().mockReturnThis(),
      stepWithRecovery: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue({
        success: true,
        traces: [],
        data: { reason: 'Success', attempt: 1 },
      }),
    }),
  },
}));

vi.mock('../../../src/core/observability/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('SmallfryLoop', () => {
  let mockInitCtx: InitCtx;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockLlm = {
      chat: vi.fn(),
      createPlan: vi.fn(),
      createPatch: vi.fn(),
    };
    mockInitCtx = {
      workspace: { workPath: '/tmp/repo', baseRepoPath: '/tmp/repo', strategy: 'direct' },
      options: { instruction: 'test', repoPath: '/tmp/repo', llm: mockLlm },
      mode: 'patch',
      fs: {
        readFile: vi.fn(),
        writeFile: vi.fn(),
        exists: vi.fn(),
        mkdir: vi.fn(),
      },
      emit: vi.fn(),
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
    vi.mocked(Pipeline.of(mockInitCtx).execute).mockResolvedValueOnce({
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
