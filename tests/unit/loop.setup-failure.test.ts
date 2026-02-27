import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { setupMock, teardownMock, clearAuditContextMock, appendAuditTrailToAuditFileMock } =
  (() => ({
    setupMock: mock(),
    teardownMock: mock(),
    clearAuditContextMock: mock(),
    appendAuditTrailToAuditFileMock: mock().mockResolvedValue(undefined),
  }))();

mock.module('../../src/core/strata/runtime/environment.js', () => ({
  RuntimeEnvironment: mock().mockImplementation(() => ({
    setup: setupMock,
    teardown: teardownMock,
  })),
}));

mock.module('../../src/core/observability/audit-trail.js', () => ({
  clearAuditTrail: mock(),
  setAuditContext: mock(),
  clearAuditContext: clearAuditContextMock,
  recordAuditEvent: mock(),
  getAuditTrail: mock(() => []),
}));

mock.module('../../src/core/observability/audit-file.js', () => ({
  appendAuditTrailToAuditFile: appendAuditTrailToAuditFileMock,
}));

import { SalmonLoop } from '../../src/core/runtime/loop.js';

describe('SalmonLoop setup failure cleanup', () => {
  const resolvedConfig = {
    observability: {
      audit: { buffer: { maxEvents: 10000, maxBytes: 1024 * 1024, droppedWarn: 100 } },
    },
    security: { redaction: { enabled: true, mark: '[REDACTED]', maxDepth: 6 } },
  } as any;

  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('tears down environment when setup fails', async () => {
    setupMock.mockRejectedValue(new Error('setup failed'));
    teardownMock.mockResolvedValue(undefined);

    const loop = new SalmonLoop(resolvedConfig);
    const result = await loop.run({
      instruction: 'test',
      repoPath: '/repo',
      strategy: 'worktree',
      llm: {
        chat: mock(),
        createPlan: mock(),
        createPatch: mock(),
      },
    } as any);

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('LOOP_FAILED');
    expect(clearAuditContextMock).toHaveBeenCalledTimes(1);
    expect(appendAuditTrailToAuditFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: '/repo',
        finalOutcome: expect.objectContaining({
          success: false,
          reasonCode: 'LOOP_FAILED',
        }),
      }),
    );
  });

  it('emits run.start and run.end around core execution', async () => {
    setupMock.mockRejectedValue(new Error('setup failed'));
    teardownMock.mockResolvedValue(undefined);
    const onEvent = mock();

    const loop = new SalmonLoop(resolvedConfig);
    await loop.run({
      instruction: 'test',
      repoPath: '/repo',
      strategy: 'worktree',
      onEvent,
      llm: {
        chat: mock(),
        createPlan: mock(),
        createPatch: mock(),
      },
    } as any);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.start',
      }),
    );
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'run.end',
        success: false,
      }),
    );
  });
});
