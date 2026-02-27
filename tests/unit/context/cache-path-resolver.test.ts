import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { ConfigError } from '../../../src/core/config/errors.js';
import { resolveContextCachePath } from '../../../src/core/context/cache/path-resolver.js';

const existsMock = mock();
const accessMock = mock();
const realpathMock = mock();

mock.module('../../../src/core/adapters/fs/file-adapter.js', () => ({
  FileAdapter: class {
    exists = existsMock;
    access = accessMock;
    realpath = realpathMock;
  },
}));

describe('resolveContextCachePath', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('fails when an allowed root is missing', async () => {
    existsMock.mockImplementation(async (path: string) => {
      return path.endsWith('.salmonloop/cache/tmp') ? false : true;
    });
    accessMock.mockResolvedValue(undefined);
    realpathMock.mockResolvedValue('/repo/.salmonloop/cache');

    await expect(
      resolveContextCachePath('/repo', {
        context: {
          cache: {
            mode: 'persistent',
            path: '.salmonloop/cache/index.json',
            allowedRoots: ['.salmonloop/cache', '.salmonloop/cache/tmp'],
          },
        },
      } as any),
    ).rejects.toThrow(new ConfigError('CONFIG_CONTEXT_CACHE_ROOT_UNAVAILABLE'));
  });
});
