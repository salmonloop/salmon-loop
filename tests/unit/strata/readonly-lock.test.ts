const { mkdirMock, writeFileMock, readFileMock, unlinkMock, renameMock, getShadowLockPathMock } =
  vi.hoisted(() => ({
    mkdirMock: vi.fn(),
    writeFileMock: vi.fn(),
    readFileMock: vi.fn(),
    unlinkMock: vi.fn(),
    renameMock: vi.fn(),
    getShadowLockPathMock: vi.fn(),
  }));

vi.mock('fs/promises', () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
  readFile: readFileMock,
  unlink: unlinkMock,
  rename: renameMock,
}));

vi.mock('../../../src/core/runtime-paths.js', () => ({
  getShadowLockPath: getShadowLockPathMock,
}));

vi.mock('../../../src/core/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  acquireLock,
  releaseLock,
} from '../../../src/core/strata/layers/shadow-driver/readonly-lock.js';

describe('readonly-lock acquireLock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('creates lock file atomically with wx flag', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/lock.pid');
    mkdirMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue(null);
    writeFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);

    await acquireLock('/tmp/s8p-wt');

    expect(writeFileMock).toHaveBeenCalledWith(
      '/tmp/s8p-wt/lock.pid',
      expect.stringContaining(`${process.pid}:`),
      { flag: 'wx' },
    );
  });

  it('retries lock creation after removing stale lock', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/lock.pid');
    mkdirMock.mockResolvedValue(undefined);
    const eexist = Object.assign(new Error('exists'), { code: 'EEXIST' });
    writeFileMock.mockRejectedValueOnce(eexist).mockResolvedValueOnce(undefined);
    readFileMock.mockResolvedValue('999:1700000000000');
    unlinkMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    await acquireLock('/tmp/s8p-wt');

    expect(unlinkMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tmp\/s8p-wt\/lock\.pid\.swap-/),
    );
    expect(writeFileMock).toHaveBeenCalledTimes(2);
  });

  it('does not remove lock file when token changed concurrently', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/lock.pid');
    mkdirMock.mockResolvedValue(undefined);
    const eexist = Object.assign(new Error('exists'), { code: 'EEXIST' });
    writeFileMock.mockRejectedValue(eexist);
    readFileMock
      .mockResolvedValueOnce('999:1700000000000:old')
      .mockResolvedValueOnce('777:1700000000000:new')
      .mockResolvedValueOnce('4242:1700000000000:live');
    vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === 4242) return true as any;
      throw new Error('ESRCH');
    });
    renameMock.mockResolvedValue(undefined);

    await expect(acquireLock('/tmp/s8p-wt')).rejects.toThrow('locked by process 4242');
    expect(unlinkMock).not.toHaveBeenCalled();
    expect(renameMock).toHaveBeenCalledTimes(2);
  });

  it('throws when lock holder is alive in another process', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/lock.pid');
    mkdirMock.mockResolvedValue(undefined);
    const eexist = Object.assign(new Error('exists'), { code: 'EEXIST' });
    writeFileMock.mockRejectedValue(eexist);
    readFileMock.mockResolvedValue('4242:1700000000000');
    unlinkMock.mockResolvedValue(undefined);
    vi.spyOn(process, 'kill').mockImplementation(() => true as any);
    renameMock.mockResolvedValue(undefined);

    await expect(acquireLock('/tmp/s8p-wt')).rejects.toThrow('locked by process 4242');
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('handles malformed lock timestamp without crashing', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/lock.pid');
    mkdirMock.mockResolvedValue(undefined);
    const eexist = Object.assign(new Error('exists'), { code: 'EEXIST' });
    writeFileMock.mockRejectedValue(eexist);
    readFileMock.mockResolvedValue('4242:bad-ts');
    renameMock.mockResolvedValue(undefined);
    vi.spyOn(process, 'kill').mockImplementation(() => true as any);

    await expect(acquireLock('/tmp/s8p-wt')).rejects.toThrow(
      'ShadowRoot is locked by process 4242 since unknown-time',
    );
  });
});

describe('readonly-lock releaseLock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('releases lock only when ownership token matches', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/release.pid');
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);

    await acquireLock('/tmp/s8p-wt');
    const expectedToken = String(writeFileMock.mock.calls[0]?.[1] || '');
    readFileMock.mockResolvedValue(expectedToken);

    await releaseLock('/tmp/s8p-wt');

    expect(unlinkMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tmp\/s8p-wt\/release\.pid\.swap-/),
    );
  });

  it('skips release when lock token mismatches current file', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/mismatch.pid');
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);

    await acquireLock('/tmp/s8p-wt');
    readFileMock.mockResolvedValue('other-process-token');

    await releaseLock('/tmp/s8p-wt');

    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('cleans up swap file when rollback rename fails', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/swap-cleanup.pid');
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    unlinkMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('rename-failed'));

    await acquireLock('/tmp/s8p-wt');
    readFileMock.mockResolvedValue('other-process-token');

    await releaseLock('/tmp/s8p-wt');

    expect(unlinkMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/tmp\/s8p-wt\/swap-cleanup\.pid\.swap-/),
    );
  });
});
