import path from 'path';

import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { setLogger } from '../../../src/core/observability/logger.js';
import { StrataFileSystemProvider } from '../../../src/core/strata/interaction/file-system-provider.js';

const fsMocks = (() => ({
  readFile: mock(),
  writeFile: mock(),
  mkdir: mock(),
  unlink: mock(),
}))();

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  promises: fsMocks,
}));

describe('StrataFileSystemProvider safety behavior', () => {
  const fileState = new Map<string, Buffer>();
  const createProvider = (): StrataFileSystemProvider =>
    new StrataFileSystemProvider({} as unknown as GitAdapter);

  beforeEach(() => {
    if (typeof mock.clearAllMocks === 'function') {
      mock.clearAllMocks();
    }
    fsMocks.readFile.mockClear();
    fsMocks.writeFile.mockClear();
    fsMocks.mkdir.mockClear();
    fsMocks.unlink.mockClear();
    fileState.clear();
    setLogger({
      error: mock(),
      warn: mock(),
      info: mock(),
      success: mock(),
      debug: mock(),
      setReporter: mock(),
    } as any);
    fsMocks.readFile.mockImplementation(async (targetPath: string) => {
      // Normalize path to handle both forward and backslash separators
      const normalizedPath = targetPath.replace(/\\/g, '/');
      for (const [key, value] of fileState.entries()) {
        if (key.replace(/\\/g, '/') === normalizedPath) {
          return Buffer.from(value);
        }
      }
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
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
    // On Windows, path.resolve converts /repo to C:\repo (or current drive)
    // We need to use the resolved absolute path
    const rootPath = path.resolve('/repo');
    const filePath = path.resolve('/repo/src/file.ts');

    fileState.set(filePath, Buffer.from('safe-content'));
    const provider = createProvider();

    const content = await provider.readFileBufferSafe(filePath, rootPath);

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
