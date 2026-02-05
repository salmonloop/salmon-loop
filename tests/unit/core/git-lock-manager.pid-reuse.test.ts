const fsMocks = vi.hoisted(() => {
  return {
    mkdir: vi.fn(),
    open: vi.fn(),
    unlink: vi.fn(),
    readFile: vi.fn(),
  };
});

vi.mock('fs/promises', () => fsMocks);

vi.mock('../../../src/core/limits.js', () => ({
  LIMITS: {
    lockAcquireHardTimeoutMs: 50,
    lockWaitTimeoutMs: 50,
    lockStaleThresholdMs: 0,
    retry: {
      io: { initialDelayMs: 0, maxDelayMs: 0 },
    },
  },
}));

describe('FileHandleManager acquireLock (PID reuse)', () => {
  const originalEnableLockInTest = process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST = '1';
  });

  afterEach(() => {
    if (originalEnableLockInTest === undefined) {
      delete process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST;
    } else {
      process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST = originalEnableLockInTest;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    vi.restoreAllMocks();
  });

  it('treats same-pid different-owner as non-self and cleans up stale lock', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });

    const handle = { writeFile: vi.fn(), close: vi.fn() };
    fsMocks.open
      .mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'EEXIST' }))
      .mockResolvedValueOnce(handle as any);

    fsMocks.readFile.mockResolvedValueOnce(
      JSON.stringify({
        pid: process.pid,
        timestamp: 0,
        owner: `process-${process.pid}`,
      }),
    );
    fsMocks.unlink.mockResolvedValueOnce(undefined);

    const { FileHandleManager } = await import('../../../src/core/adapters/git/lock-manager.js');
    const mgr = new FileHandleManager();

    await expect(mgr.acquireLock('/repo')).resolves.toBeUndefined();
    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
    expect(fsMocks.open).toHaveBeenCalledTimes(2);
  });
});
