const { setupMock, teardownMock, clearAuditContextMock } = vi.hoisted(() => ({
  setupMock: vi.fn(),
  teardownMock: vi.fn(),
  clearAuditContextMock: vi.fn(),
}));

vi.mock('../../src/core/strata/runtime/environment.js', () => ({
  RuntimeEnvironment: vi.fn().mockImplementation(() => ({
    setup: setupMock,
    teardown: teardownMock,
  })),
}));

vi.mock('../../src/core/audit-trail.js', () => ({
  clearAuditTrail: vi.fn(),
  setAuditContext: vi.fn(),
  clearAuditContext: clearAuditContextMock,
}));

import { SalmonLoop } from '../../src/core/loop.js';

describe('SalmonLoop setup failure cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        chat: vi.fn(),
        createPlan: vi.fn(),
        createPatch: vi.fn(),
      },
    } as any);

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('LOOP_FAILED');
    expect(setupMock).toHaveBeenCalledTimes(1);
    expect(teardownMock).toHaveBeenCalledTimes(1);
    expect(clearAuditContextMock).toHaveBeenCalledTimes(1);
  });
});
