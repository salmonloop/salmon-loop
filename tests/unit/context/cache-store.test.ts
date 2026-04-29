import { beforeEach, describe, expect, it, mock } from 'bun:test';

const readFileMock = mock();
const writeFileAtomicMock = mock();
const recordAuditEventMock = mock();

mock.module('../../../src/core/adapters/fs/file-adapter.js', () => ({
  FileAdapter: class {
    readFile = readFileMock;
    writeFileAtomic = writeFileAtomicMock;
    writeFile = mock();
  },
}));
mock.module('../../../src/core/observability/audit-trail.js', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

async function loadStoreModule() {
  return await import('../../../src/core/context/cache/store.js');
}

describe('PersistentContextCacheStore', () => {
  beforeEach(() => {
    readFileMock.mockClear();
    writeFileAtomicMock.mockClear();
    recordAuditEventMock.mockClear();
  });

  it('fails fast in strict mode when cache file is malformed', async () => {
    readFileMock.mockResolvedValue('{bad-json');
    const { PersistentContextCacheStore } = await loadStoreModule();
    const store = new PersistentContextCacheStore('/repo/.salmonloop/cache/context-cache.json', {
      strict: true,
    });
    await expect(store.get('key')).rejects.toThrow(/context cache/i);
  });

  it('records audit events and runs cleanup when strict load fails', async () => {
    readFileMock.mockRejectedValue(new Error('EACCES: permission denied'));
    const cleanupMock = mock();
    const { PersistentContextCacheStore } = await loadStoreModule();
    const store = new PersistentContextCacheStore('/repo/.salmonloop/cache/context-cache.json', {
      strict: true,
      cleanupFn: cleanupMock,
    });

    await expect(store.get('key')).rejects.toThrow(/CONTEXT_CACHE_IO/);

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'context.cache.load_failure',
      expect.objectContaining({
        code: 'CONTEXT_CACHE_IO',
        filePath: '/repo/.salmonloop/cache/context-cache.json',
      }),
      expect.objectContaining({
        source: 'context.cache',
        severity: 'high',
        phase: 'CONTEXT',
      }),
    );
    expect(cleanupMock).toHaveBeenCalledTimes(1);
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

  it('redacts sensitive fields before persisting', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    const { PersistentContextCacheStore } = await loadStoreModule();
    const store = new PersistentContextCacheStore('/repo/.salmonloop/cache/context-cache.json', {
      strict: true,
    });

    await store.set('k', {
      result: {
        prompt: 'p',
        context: {
          repoPath: '/repo',
          instruction: 'use token sk-1234567890abcdef',
        } as any,
        meta: { usedChars: 1, truncated: false, includedFiles: [] } as any,
      } as any,
      trackedFiles: [],
      signature: 's',
      intentSignature: 'i',
    });

    const payload = writeFileAtomicMock.mock.calls[0]![1] as Buffer;
    const raw = payload.toString('utf-8');
    expect(raw).not.toContain('sk-1234567890abcdef');
    expect(raw).toContain('[REDACTED]');
  });

  it('falls back to memory when payload exceeds max size', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));
    const { PersistentContextCacheStore } = await loadStoreModule();
    const store = new PersistentContextCacheStore('/repo/.salmonloop/cache/context-cache.json', {
      strict: false,
      fallbackMode: 'memory',
      maxPayloadBytes: 64,
    } as any);

    await store.set('k', {
      result: {
        prompt: 'p',
        context: {
          repoPath: '/repo',
          instruction: 'x'.repeat(500),
        } as any,
        meta: { usedChars: 1, truncated: false, includedFiles: [] } as any,
      } as any,
      trackedFiles: [],
      signature: 's',
      intentSignature: 'i',
    });

    expect(writeFileAtomicMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'context.cache.oversize',
      expect.any(Object),
      expect.objectContaining({ severity: 'high' }),
    );
  });
});
