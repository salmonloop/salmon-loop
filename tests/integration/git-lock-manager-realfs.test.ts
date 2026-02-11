import { FileHandleManager } from '../../src/core/adapters/git/lock-manager.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('FileHandleManager Integration (Real Filesystem)', () => {
  const helper = new RealFsTestHelper();
  const originalEnableLockInTest = process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST;

  beforeEach(() => {
    process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST = '1';
  });

  afterEach(async () => {
    if (originalEnableLockInTest === undefined) {
      delete process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST;
    } else {
      process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST = originalEnableLockInTest;
    }
    await helper.cleanup();
  });

  it('creates and releases lock file with real ownership checks', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'README.md', content: 'lock test\n' }],
    });
    const manager = new FileHandleManager();

    await manager.acquireLock(repo.path);

    const lockExists = await helper.fileExists(repo.path, '.salmonloop.lock');
    expect(lockExists).toBe(true);
    const lockContent = await helper.readFile(repo.path, '.salmonloop.lock');
    expect(String(lockContent)).toContain('"owner"');

    await manager.releaseLock(repo.path);

    const lockExistsAfter = await helper.fileExists(repo.path, '.salmonloop.lock');
    expect(lockExistsAfter).toBe(false);
  });

  it('does not let a different manager release an unowned lock', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'README.md', content: 'owner test\n' }],
    });
    const owner = new FileHandleManager();
    const outsider = new FileHandleManager();

    await owner.acquireLock(repo.path);
    await outsider.releaseLock(repo.path);

    const stillLocked = await helper.fileExists(repo.path, '.salmonloop.lock');
    expect(stillLocked).toBe(true);

    await owner.releaseLock(repo.path);
    const cleared = await helper.fileExists(repo.path, '.salmonloop.lock');
    expect(cleared).toBe(false);
  });
});
