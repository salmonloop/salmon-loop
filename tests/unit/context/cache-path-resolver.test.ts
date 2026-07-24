import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { ConfigError } from '../../../src/core/config/errors.js';
import { resolveContextCachePath } from '../../../src/core/context/cache/path-resolver.js';
import { setLogger } from '../../../src/core/observability/logger.js';

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
    mock.restore();
    setLogger({
      error: mock(),
      warn: mock(),
      info: mock(),
      success: mock(),
      setReporter: mock(),
    } as any);
  });

  it('fails when an allowed root is missing', async () => {
    existsMock.mockImplementation(async (_path: string) => {
      return false; // All paths don't exist
    });
    accessMock.mockResolvedValue(undefined);
    realpathMock.mockResolvedValue('/repo/.salmonloop/cache');

    const mkdirMock = mock(async () => {
      throw new Error('Permission denied');
    });

    const fileAdapter = {
      exists: existsMock,
      access: accessMock,
      realpath: realpathMock,
      mkdir: mkdirMock,
    };

    await expect(
      resolveContextCachePath(
        '/repo',
        {
          context: {
            cache: {
              mode: 'persistent',
              path: '.salmonloop/cache/index.json',
              allowedRoots: ['.salmonloop/cache', '.salmonloop/cache/tmp'],
            },
          },
        } as any,
        { fileAdapter },
      ),
    ).rejects.toThrow(new ConfigError('CONFIG_CONTEXT_CACHE_ROOT_UNAVAILABLE'));
  });
});
