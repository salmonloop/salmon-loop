import { join } from 'path';

import { beforeEach, describe, expect, it, mock } from 'bun:test';

const detectDependencyPathsMock = mock();

const existsSyncMock = mock();
const symlinkMock = mock();
const lstatMock = mock();
const realpathMock = mock();

const debugMock = mock();
const warnMock = mock();

mock.module('../../../src/core/strata/layers/shadow-driver/strategy.js', () => ({
  detectDependencyPaths: detectDependencyPathsMock,
  determineStrategy: mock(),
  planDependencyPaths: mock(),
}));

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  existsSync: existsSyncMock,
  symlink: symlinkMock,
  lstat: lstatMock,
  realpath: realpathMock,
  rm: mock(),
  mkdir: mock(),
}));

mock.module('../../../src/core/observability/logger.js', () => ({
  getLogger: () => ({
    debug: debugMock,
    warn: warnMock,
    error: mock(),
  }),
}));

async function loadShadowDriver() {
  return await import('../../../src/core/strata/layers/shadow-driver/shadow-driver.js');
}

function fsError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code });
}

describe('ShadowDriver.hydrate', () => {
  beforeEach(() => {
    detectDependencyPathsMock.mockReset();
    existsSyncMock.mockReset();
    symlinkMock.mockReset();
    lstatMock.mockReset();
    realpathMock.mockReset();
    debugMock.mockReset();
    warnMock.mockReset();

    detectDependencyPathsMock.mockResolvedValue(['node_modules']);
    existsSyncMock.mockReturnValue(true);
  });

  it('accepts an existing dependency projection when it already resolves to the expected source', async () => {
    const repoRoot = process.platform === 'win32' ? 'C:\\repo' : '/repo';
    const shadowRoot = process.platform === 'win32' ? 'C:\\shadow' : '/shadow';
    const sourcePath = join(repoRoot, 'node_modules');
    const targetPath = join(shadowRoot, 'node_modules');

    symlinkMock.mockRejectedValue(fsError('EISDIR', 'illegal operation on a directory'));
    lstatMock.mockResolvedValue({ isSymbolicLink: () => true });
    realpathMock.mockImplementation(async (resolvedPath: string) => {
      if (resolvedPath === sourcePath) {
        return sourcePath;
      }
      if (resolvedPath === targetPath) {
        return sourcePath;
      }
      throw fsError('ENOENT');
    });

    const { ShadowDriver } = await loadShadowDriver();

    await expect(ShadowDriver.hydrate(repoRoot, shadowRoot)).resolves.toBeUndefined();
  });

  it('throws when an existing target does not resolve to the expected dependency source', async () => {
    const repoRoot = process.platform === 'win32' ? 'C:\\repo' : '/repo';
    const shadowRoot = process.platform === 'win32' ? 'C:\\shadow' : '/shadow';
    const sourcePath = join(repoRoot, 'node_modules');
    const targetPath = join(shadowRoot, 'node_modules');

    symlinkMock.mockRejectedValue(fsError('EISDIR', 'illegal operation on a directory'));
    lstatMock.mockResolvedValue({ isSymbolicLink: () => false });
    realpathMock.mockImplementation(async (resolvedPath: string) => {
      if (resolvedPath === sourcePath) {
        return sourcePath;
      }
      if (resolvedPath === targetPath) {
        return targetPath;
      }
      throw fsError('ENOENT');
    });

    const { ShadowDriver } = await loadShadowDriver();

    await expect(ShadowDriver.hydrate(repoRoot, shadowRoot)).rejects.toThrow(/node_modules/i);
  });
});
