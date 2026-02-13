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

vi.mock('../../../src/core/runtime/paths.js', () => ({
  getShadowLockPath: getShadowLockPathMock,
}));

vi.mock('../../../src/core/observability/logger.js', () => ({
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

function eexist(): NodeJS.ErrnoException {
  return Object.assign(new Error('exists'), { code: 'EEXIST' });
}

function enoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('missing'), { code: 'ENOENT' });
}

describe('readonly-lock behavior safety', () => {
  const fileState = new Map<string, string>();

  const configureStatefulFs = () => {
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockImplementation(
      async (targetPath: string, content: string, options?: { flag?: string }) => {
        if (options?.flag === 'wx' && fileState.has(targetPath)) {
          throw eexist();
        }
        fileState.set(targetPath, String(content));
      },
    );
    readFileMock.mockImplementation(async (targetPath: string) => {
      if (!fileState.has(targetPath)) throw enoent();
      return fileState.get(targetPath);
    });
    renameMock.mockImplementation(async (fromPath: string, toPath: string) => {
      if (!fileState.has(fromPath)) throw enoent();
      const payload = fileState.get(fromPath) as string;
      fileState.delete(fromPath);
      fileState.set(toPath, payload);
    });
    unlinkMock.mockImplementation(async (targetPath: string) => {
      if (!fileState.has(targetPath)) throw enoent();
      fileState.delete(targetPath);
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    fileState.clear();
    configureStatefulFs();
    getShadowLockPathMock.mockImplementation((shadowRoot: string) => `${shadowRoot}/lock.pid`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acquires lock atomically with process token payload', async () => {
    await acquireLock('/tmp/s8p-wt');

    const payload = fileState.get('/tmp/s8p-wt/lock.pid');
    expect(payload).toBeTruthy();
    const [pidPart, tsPart, tokenPart] = String(payload).split(':');

    expect(Number(pidPart)).toBe(process.pid);
    expect(Number.isFinite(Number(tsPart))).toBe(true);
    expect(tokenPart.length).toBeGreaterThan(0);
  });

  it('replaces stale lock from dead process', async () => {
    const lockPath = '/tmp/s8p-wt/lock.pid';
    fileState.set(lockPath, '999:1700000000000:stale-token');
    vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === 999) throw new Error('ESRCH');
      return true;
    });

    await acquireLock('/tmp/s8p-wt');

    const payload = String(fileState.get(lockPath));
    expect(payload.startsWith(`${process.pid}:`)).toBe(true);
    expect(payload.includes('stale-token')).toBe(false);
  });

  it('keeps existing lock when holder process is alive', async () => {
    const lockPath = '/tmp/s8p-wt/lock.pid';
    const existing = '4242:1700000000000:live-token';
    fileState.set(lockPath, existing);
    vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === 4242) return true;
      throw new Error('ESRCH');
    });

    await expect(acquireLock('/tmp/s8p-wt')).rejects.toThrow('locked by process 4242');
    expect(fileState.get(lockPath)).toBe(existing);
  });

  it('treats EPERM process probe as alive and keeps existing lock', async () => {
    const lockPath = '/tmp/s8p-wt/lock.pid';
    const existing = '4242:1700000000000:live-token';
    fileState.set(lockPath, existing);
    vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
      if (pid === 4242) {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    });

    await expect(acquireLock('/tmp/s8p-wt')).rejects.toThrow('locked by process 4242');
    expect(fileState.get(lockPath)).toBe(existing);
  });

  it('replaces malformed stale lock payload safely', async () => {
    const lockPath = '/tmp/s8p-wt/lock.pid';
    fileState.set(lockPath, 'not-a-pid:1700000000000:bad-token');

    await acquireLock('/tmp/s8p-wt');

    const payload = String(fileState.get(lockPath));
    expect(payload.startsWith(`${process.pid}:`)).toBe(true);
    expect(payload.includes('bad-token')).toBe(false);
  });

  it('releases lock only when ownership token still matches', async () => {
    const lockPath = '/tmp/s8p-wt/lock.pid';
    await acquireLock('/tmp/s8p-wt');

    const ownedPayload = String(fileState.get(lockPath));
    await releaseLock('/tmp/s8p-wt');
    expect(fileState.has(lockPath)).toBe(false);

    await acquireLock('/tmp/s8p-wt');
    fileState.set(lockPath, 'other-process-token');
    await releaseLock('/tmp/s8p-wt');

    expect(fileState.get(lockPath)).toBe('other-process-token');
    expect(fileState.get(lockPath)).not.toBe(ownedPayload);
  });
});
