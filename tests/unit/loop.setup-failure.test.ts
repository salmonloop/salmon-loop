import { beforeEach, describe, expect, it, mock } from 'bun:test';

const {
  setupMock,
  teardownMock,
  clearAuditContextMock,
  appendAuditTrailToAuditFileMock,
  recordAuditEventMock,
} = (() => ({
  setupMock: mock(),
  teardownMock: mock(),
  clearAuditContextMock: mock(),
  appendAuditTrailToAuditFileMock: mock().mockResolvedValue(undefined),
  recordAuditEventMock: mock(),
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
  recordAuditEvent: recordAuditEventMock,
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
    const setupError = Object.assign(new Error('setup failed'), {
      code: 'PREFLIGHT_SNAPSHOT_FAILED',
      safeMeta: {
        strategy: 'worktree',
        worktreeEnabled: true,
        repoPathHash: 'testhash1234567890',
      },
    });
    setupMock.mockRejectedValue(setupError);
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
    expect(result.errorCode).toBe('PREFLIGHT_SNAPSHOT_FAILED');
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'run.failed.diagnostic',
      expect.objectContaining({
        errorName: 'Error',
        errorCode: 'PREFLIGHT_SNAPSHOT_FAILED',
        phase: 'PREFLIGHT',
        source: 'runtime.loop.catch',
        redacted: true,
        safeMeta: expect.objectContaining({
          strategy: 'worktree',
          worktreeEnabled: true,
          repoPathHash: expect.any(String),
        }),
      }),
      expect.any(Object),
    );
    expect(clearAuditContextMock).toHaveBeenCalledTimes(1);
    expect(appendAuditTrailToAuditFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        repoPath: '/repo',
        finalOutcome: expect.objectContaining({
          success: false,
          reasonCode: 'LOOP_FAILED',
          errorCode: 'PREFLIGHT_SNAPSHOT_FAILED',
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
