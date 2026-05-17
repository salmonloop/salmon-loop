import { FileHandleManager } from '../../../src/core/adapters/git/lock-manager.js';

const fsMocks = (() => {
  return {
    mkdir: mock(),
    open: mock(),
    unlink: mock(),
    readFile: mock(),
  };
})();

mock.module('fs/promises', () => fsMocks);

describe('FileHandleManager releaseLock', () => {
  const originalEnableLockInTest = process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST;

  beforeEach(() => {
    process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST = '1';
  });

  afterEach(() => {
    if (originalEnableLockInTest === undefined) {
      delete process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST;
    } else {
      process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST = originalEnableLockInTest;
    }
  });

  it('does not unlink when ownership cannot be verified', async () => {
    fsMocks.readFile.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));

    const mgr = new FileHandleManager();
    const events: any[] = [];
    await mgr.releaseLock('/repo', (e) => events.push(e));

    expect(fsMocks.unlink).not.toHaveBeenCalled();
    expect(events.some((e) => e?.type === 'resource.status' && e?.resource === 'lock')).toBe(true);
  });

  it('does not unlink when lock is owned by a different owner', async () => {
    fsMocks.readFile.mockResolvedValueOnce(
      JSON.stringify({ pid: 123, timestamp: Date.now(), owner: 'other-owner' }),
    );

    const mgr = new FileHandleManager();
    await mgr.releaseLock('/repo');

    expect(fsMocks.unlink).not.toHaveBeenCalled();
  });

  it('unlinks when lock is owned by current process owner', async () => {
    const mgr = new FileHandleManager();
    const owner = (mgr as any).currentOwner as string;
    fsMocks.readFile.mockResolvedValueOnce(
      JSON.stringify({ pid: process.pid, timestamp: Date.now(), owner }),
    );
    fsMocks.unlink.mockResolvedValueOnce(undefined);

    await mgr.releaseLock('/repo');

    expect(fsMocks.unlink).toHaveBeenCalledTimes(1);
  });
});
