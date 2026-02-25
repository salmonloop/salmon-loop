const { setupMock, teardownMock, clearAuditContextMock } = (() => ({
  setupMock: mock(),
  teardownMock: mock(),
  clearAuditContextMock: mock(),
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
  getAuditTrail: mock(() => []),
}));

import { SalmonLoop } from '../../src/core/runtime/loop.js';

describe('SalmonLoop setup failure cleanup', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('tears down environment when setup fails', async () => {
    setupMock.mockRejectedValue(new Error('setup failed'));
    teardownMock.mockResolvedValue(undefined);

    const loop = new SalmonLoop();
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
  });
});
