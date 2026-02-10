const { mkdirMock, writeFileMock, readFileMock, unlinkMock, getShadowLockPathMock } = vi.hoisted(
  () => ({
    mkdirMock: vi.fn(),
    writeFileMock: vi.fn(),
    readFileMock: vi.fn(),
    unlinkMock: vi.fn(),
    getShadowLockPathMock: vi.fn(),
  }),
);

vi.mock('fs/promises', () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
  readFile: readFileMock,
  unlink: unlinkMock,
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

import { acquireLock } from '../../../src/core/strata/layers/shadow-driver/readonly-lock.js';

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
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    await acquireLock('/tmp/s8p-wt');

    expect(unlinkMock).toHaveBeenCalledWith('/tmp/s8p-wt/lock.pid');
    expect(writeFileMock).toHaveBeenCalledTimes(2);
  });

  it('throws when lock holder is alive in another process', async () => {
    getShadowLockPathMock.mockReturnValue('/tmp/s8p-wt/lock.pid');
    mkdirMock.mockResolvedValue(undefined);
    const eexist = Object.assign(new Error('exists'), { code: 'EEXIST' });
    writeFileMock.mockRejectedValue(eexist);
    readFileMock.mockResolvedValue('4242:1700000000000');
    unlinkMock.mockResolvedValue(undefined);
    vi.spyOn(process, 'kill').mockImplementation(() => true as any);

    await expect(acquireLock('/tmp/s8p-wt')).rejects.toThrow('locked by process 4242');
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});
