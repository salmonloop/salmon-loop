import {
  acquireLock,
  releaseLock,
} from '../../src/core/strata/layers/shadow-driver/readonly-lock.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('readonly-lock Integration (Real Filesystem)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('acquires and releases lock file with real filesystem state', async () => {
    const shadowRoot = await helper.createTempDir('shadow-root-');
    const relativeLockPath = '.salmonloop/runtime/locks/shadow.lock';

    await acquireLock(shadowRoot);

    const existsAfterAcquire = await helper.fileExists(shadowRoot, relativeLockPath);
    expect(existsAfterAcquire).toBe(true);
    const payload = await helper.readFile(shadowRoot, relativeLockPath);
    expect(String(payload).startsWith(`${process.pid}:`)).toBe(true);

    await releaseLock(shadowRoot);

    const existsAfterRelease = await helper.fileExists(shadowRoot, relativeLockPath);
    expect(existsAfterRelease).toBe(false);
  });

  it('replaces stale lock payload from a dead process', async () => {
    const shadowRoot = await helper.createTempDir('shadow-root-');
    const relativeLockPath = '.salmonloop/runtime/locks/shadow.lock';
    await helper.writeFile(shadowRoot, relativeLockPath, '999999:1700000000000:stale-token');

    await acquireLock(shadowRoot);

    const payload = String(await helper.readFile(shadowRoot, relativeLockPath));
    expect(payload.startsWith(`${process.pid}:`)).toBe(true);
    expect(payload.includes('stale-token')).toBe(false);

    await releaseLock(shadowRoot);
  });

  it('keeps lock file when ownership token no longer matches', async () => {
    const shadowRoot = await helper.createTempDir('shadow-root-');
    const relativeLockPath = '.salmonloop/runtime/locks/shadow.lock';

    await acquireLock(shadowRoot);
    await helper.writeFile(shadowRoot, relativeLockPath, '1234:1700000000000:other-token');

    await releaseLock(shadowRoot);

    const payloadAfterRelease = String(await helper.readFile(shadowRoot, relativeLockPath));
    expect(payloadAfterRelease).toBe('1234:1700000000000:other-token');
  });
});
