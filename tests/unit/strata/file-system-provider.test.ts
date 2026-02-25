const fsMocks = (() => ({
  readFile: mock(),
  writeFile: mock(),
  mkdir: mock(),
  unlink: mock(),
}))();

mock.module('fs', () => ({
  promises: fsMocks,
}));

import type { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { StrataFileSystemProvider } from '../../../src/core/strata/interaction/file-system-provider.js';

describe('StrataFileSystemProvider safety behavior', () => {
  const fileState = new Map<string, Buffer>();
  const createProvider = (): StrataFileSystemProvider =>
    new StrataFileSystemProvider({} as unknown as GitAdapter);

  beforeEach(() => {
    mock.clearAllMocks();
    fileState.clear();
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      const content = fileState.get(targetPath);
      if (!content) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return Buffer.from(content);
    });
    fsMocks.writeFile.mockImplementation(async (targetPath: string, content: Buffer | string) => {
      const normalized = Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content);
      fileState.set(targetPath, normalized);
    });
    fsMocks.mkdir.mockResolvedValue(undefined);
    fsMocks.unlink.mockImplementation(async (targetPath: string) => {
      if (!fileState.has(targetPath)) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      fileState.delete(targetPath);
    });
  });

  it('returns null for missing file on readYours', async () => {
    fsMocks.readFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const provider = createProvider();

    const content = await provider.readYours('/repo', 'missing.ts');

    expect(content).toBeNull();
  });

  it('blocks path traversal before filesystem reads', async () => {
    const provider = createProvider();

    await expect(provider.readYours('/repo', '../secret.ts')).rejects.toThrow('Security Violation');
    expect(fsMocks.readFile).not.toHaveBeenCalled();
  });

  it('returns buffered content for safe reads with root context', async () => {
    fileState.set('/repo/src/file.ts', Buffer.from('safe-content'));
    const provider = createProvider();

    const content = await provider.readFileBufferSafe('/repo/src/file.ts', '/repo');

    expect(content?.toString()).toBe('safe-content');
  });

  it('does not swallow unexpected filesystem errors', async () => {
    fsMocks.readFile.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const provider = createProvider();

    await expect(provider.readYours('/repo', 'secret.ts')).rejects.toThrow('denied');
  });

  it('applies write operations in sandbox when root context is provided', async () => {
    const provider = createProvider();

    await provider.writeFile('/repo/src/out.ts', 'content', '/repo');
    await provider.mkdir('/repo/src/generated', { recursive: true }, '/repo');
    const contentBeforeDelete = await provider.readFileBufferSafe('/repo/src/out.ts', '/repo');
    await provider.unlink('/repo/src/out.ts', '/repo');
    const contentAfterDelete = await provider.readFileBufferSafe('/repo/src/out.ts', '/repo');

    expect(contentBeforeDelete?.toString()).toBe('content');
    expect(contentAfterDelete).toBeNull();
  });

  it('rejects write operations that escape sandbox root', async () => {
    const provider = createProvider();

    await expect(provider.writeFile('/repo/../../etc/passwd', 'content', '/repo')).rejects.toThrow(
      'Security Violation',
    );
    expect(fsMocks.writeFile).not.toHaveBeenCalled();
  });

  it('classifies binary content and returns false on read failure', async () => {
    fsMocks.readFile.mockResolvedValueOnce(Buffer.from([0, 1, 2]));
    fsMocks.readFile.mockRejectedValueOnce(new Error('io-failure'));
    const provider = createProvider();

    const binary = await provider.isBinary('/repo/a.bin', '/repo');
    const fallback = await provider.isBinary('/repo/b.bin', '/repo');

    expect(binary).toBe(true);
    expect(fallback).toBe(false);
  });
});
