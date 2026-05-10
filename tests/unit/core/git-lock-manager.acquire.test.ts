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
    lockAcquireHardTimeoutMs: 20,
    lockWaitTimeoutMs: 200,
    lockStaleThresholdMs: 0,
    retry: {
      io: { initialDelayMs: 100, maxDelayMs: 100 },
    },
  },
}));

describe('FileHandleManager acquireLock safety paths', () => {
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

  it('writes fresh lock metadata when forceUnlock is enabled', async () => {
    const handle = {
      writeFile: mock().mockResolvedValue(undefined),
      close: mock().mockResolvedValue(undefined),
    };
    fsMocks.open.mockResolvedValueOnce(handle as any);
    fsMocks.unlink.mockResolvedValue(undefined);

    const { FileHandleManager } = await import('../../../src/core/adapters/git/lock-manager.js');
    const manager = new FileHandleManager();

    await manager.acquireLock('/repo', true);

    const metadataRaw = handle.writeFile.mock.calls[0]?.[0];
    expect(typeof metadataRaw).toBe('string');
    const metadata = JSON.parse(metadataRaw) as {
      pid: number;
      timestamp: number;
      owner: string;
    };
    expect(metadata.pid).toBe(process.pid);
    expect(metadata.timestamp).toBeGreaterThan(0);
    expect(metadata.owner.startsWith('process-')).toBe(true);
  });

  it('fails fast with hard-timeout when lock holder stays alive', async () => {
    fsMocks.open.mockRejectedValue(Object.assign(new Error('exists'), { code: 'EEXIST' }));
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        pid: 4242,
        timestamp: Date.now(),
        owner: 'another-owner',
      }),
    );
    spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === 4242) return true as any;
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });

    const { FileHandleManager } = await import('../../../src/core/adapters/git/lock-manager.js');
    const manager = new FileHandleManager();
    const events: any[] = [];

    await expect(
      manager.acquireLock('/repo', false, (event) => events.push(event)),
    ).rejects.toThrow(/within hard timeout/);

    const hasHardTimeoutWarning = events.some(
      (event) =>
        event?.type === 'resource.status' &&
        event?.resource === 'lock' &&
        event?.status === 'warning',
    );
    expect(hasHardTimeoutWarning).toBe(true);
  });

  it('treats EPERM process probe as alive and never force-removes lock', async () => {
    fsMocks.open.mockRejectedValue(Object.assign(new Error('exists'), { code: 'EEXIST' }));
    fsMocks.readFile.mockResolvedValue(
      JSON.stringify({
        pid: 7777,
        timestamp: Date.now(),
        owner: 'another-owner',
      }),
    );
    spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === 7777) {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });

    const { FileHandleManager } = await import('../../../src/core/adapters/git/lock-manager.js');
    const manager = new FileHandleManager();

    await expect(manager.acquireLock('/repo')).rejects.toThrow(/within hard timeout/);
    expect(fsMocks.unlink).not.toHaveBeenCalled();
  });
});
