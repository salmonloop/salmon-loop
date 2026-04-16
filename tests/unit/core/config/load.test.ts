import { beforeEach, describe, expect, it, mock } from 'bun:test';

const readFileMock = mock();

mock.module('../../../../src/core/adapters/fs/node-fs.js', () => ({
  readFile: readFileMock,
}));

mock.module('../../../../src/core/config/paths.js', () => ({
  getDefaultRepoConfigPaths: () => ['/repo/config.yaml', '/repo/config.json'],
  getDefaultUserConfigPaths: () => ['/user/config.yaml', '/user/config.json'],
  resolveConfigPath: (_repoRoot: string, configPath: string) => `/resolved/${configPath}`,
}));

import { loadConfigStack } from '../../../../src/core/config/load.js';

const missing = () => {
  const err = new Error('missing') as Error & { code?: string };
  err.code = 'ENOENT';
  throw err;
};

describe('loadConfigStack', () => {
  beforeEach(() => {
    readFileMock.mockReset();
  });

  it('loads repo and user config when both exist', async () => {
    readFileMock.mockImplementation((path: string) => {
      if (path === '/repo/config.yaml') {
        return JSON.stringify({ version: 1, mode: 'interactive' });
      }
      if (path === '/user/config.yaml') {
        return JSON.stringify({ version: 1, mode: 'yolo' });
      }
      return missing();
    });

    const loaded = await loadConfigStack({ repoRoot: '/repo', enabled: true });

    expect(loaded.repo?.path).toBe('/repo/config.yaml');
    expect(loaded.repo?.config.mode).toBe('interactive');
    expect(loaded.user?.path).toBe('/user/config.yaml');
    expect(loaded.user?.config.mode).toBe('yolo');
  });

  it('loads user config when repo config is missing', async () => {
    readFileMock.mockImplementation((path: string) => {
      if (path.startsWith('/repo/')) return missing();
      if (path === '/user/config.yaml') {
        return JSON.stringify({ version: 1, mode: 'yolo' });
      }
      return missing();
    });

    const loaded = await loadConfigStack({ repoRoot: '/repo', enabled: true });

    expect(loaded.repo).toBeUndefined();
    expect(loaded.user?.path).toBe('/user/config.yaml');
    expect(loaded.user?.config.mode).toBe('yolo');
  });
});
