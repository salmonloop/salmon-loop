const fsMocks = (() => {
  return {
    mkdir: mock(),
    open: mock(),
    unlink: mock(),
    readFile: mock(),
  };
})();

mock.module('fs/promises', () => fsMocks);

mock.module('../../../src/core/config/limits.js', () => ({
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
    mock.restore();
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
    mock.restore();
  });

  it('treats same-pid different-owner as non-self and cleans up stale lock', async () => {
    spyOn(Date, 'now').mockReturnValue(1000);
    spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });

    const handle = { writeFile: mock(), close: mock() };
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
