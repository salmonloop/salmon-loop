import { beforeEach, describe, expect, it, mock } from 'bun:test';

const readFileMock = mock();
const writeFileAtomicMock = mock();

mock.module('../../../src/core/adapters/fs/file-adapter.js', () => ({
  FileAdapter: class {
    readFile = readFileMock;
    writeFileAtomic = writeFileAtomicMock;
    writeFile = mock();
  },
}));

async function loadStoreModule() {
  return await import('../../../src/core/context/cache/store.js');
}

describe('PersistentContextCacheStore', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('fails fast in strict mode when cache file is malformed', async () => {
    readFileMock.mockResolvedValue('{bad-json');
    const { PersistentContextCacheStore } = await loadStoreModule();
    const store = new PersistentContextCacheStore('/repo/.salmonloop/cache/context-cache.json', {
      strict: true,
    });
    await expect(store.get('key')).rejects.toThrow(/context cache/i);
  });

  it('uses atomic writes for persistence', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    const { PersistentContextCacheStore } = await loadStoreModule();
    const store = new PersistentContextCacheStore('/repo/.salmonloop/cache/context-cache.json', {
      strict: true,
    });
    await store.set('k', {
      result: {
        prompt: 'p',
        context: { repoPath: '/repo', instruction: 'x' } as any,
        meta: { usedChars: 1, truncated: false, includedFiles: [] } as any,
      } as any,
      trackedFiles: [],
      signature: 's',
      intentSignature: 'i',
    });

    expect(writeFileAtomicMock).toHaveBeenCalledTimes(1);
  });
});
