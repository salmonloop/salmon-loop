import { describe, expect, it, mock } from 'bun:test';

import { ReadOnlyFileSystem } from '../../../../../src/core/adapters/fs/readonly-filesystem.js';
import type { FileSystem } from '../../../../../src/core/types/execution.js';
import { text } from '../../../../../src/locales/index.js';

describe('ReadOnlyFileSystem', () => {
  it('should delegate readFile to the real FileSystem', async () => {
    const mockFs: FileSystem = {
      readFile: mock(async () => 'content'),
      writeFile: mock(async () => {}),
      exists: mock(async () => true),
      mkdir: mock(async () => {}),
    };
    const readOnlyFs = new ReadOnlyFileSystem(mockFs);

    const result = await readOnlyFs.readFile('/test/file.txt', 'utf8');

    expect(result).toBe('content');
    expect(mockFs.readFile).toHaveBeenCalledWith('/test/file.txt', 'utf8');
    expect(mockFs.readFile).toHaveBeenCalledTimes(1);
  });

  it('should delegate exists to the real FileSystem', async () => {
    const mockFs: FileSystem = {
      readFile: mock(async () => ''),
      writeFile: mock(async () => {}),
      exists: mock(async () => true),
      mkdir: mock(async () => {}),
    };
    const readOnlyFs = new ReadOnlyFileSystem(mockFs);

    const result = await readOnlyFs.exists('/test/dir');

    expect(result).toBe(true);
    expect(mockFs.exists).toHaveBeenCalledWith('/test/dir');
    expect(mockFs.exists).toHaveBeenCalledTimes(1);
  });

  it('should block writeFile and throw an error', async () => {
    const mockFs: FileSystem = {
      readFile: mock(async () => ''),
      writeFile: mock(async () => {}),
      exists: mock(async () => true),
      mkdir: mock(async () => {}),
    };
    const readOnlyFs = new ReadOnlyFileSystem(mockFs);

    await expect(readOnlyFs.writeFile('/test/file.txt', 'new content')).rejects.toThrow(
      text.grizzco.errors.readOnlyFileSystem('writeFile'),
    );
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });

  it('should block mkdir and throw an error', async () => {
    const mockFs: FileSystem = {
      readFile: mock(async () => ''),
      writeFile: mock(async () => {}),
      exists: mock(async () => true),
      mkdir: mock(async () => {}),
    };
    const readOnlyFs = new ReadOnlyFileSystem(mockFs);

    await expect(readOnlyFs.mkdir('/test/dir', { recursive: true })).rejects.toThrow(
      text.grizzco.errors.readOnlyFileSystem('mkdir'),
    );
    expect(mockFs.mkdir).not.toHaveBeenCalled();
  });
});
