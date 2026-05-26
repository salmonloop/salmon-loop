import * as fsPromises from 'fs/promises';

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { copyFile, writeFileUtf8 } from '../../../../src/cli/utils/safe-fs.js';

describe('cli/utils/safe-fs', () => {
  let lstatSpy: ReturnType<typeof spyOn>;
  let writeFileSpy: ReturnType<typeof spyOn>;
  let copyFileSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    writeFileSpy = spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined as any);
    copyFileSpy = spyOn(fsPromises, 'copyFile').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    if (lstatSpy) lstatSpy.mockRestore();
    if (writeFileSpy) writeFileSpy.mockRestore();
    if (copyFileSpy) copyFileSpy.mockRestore();
  });

  describe('assertNotSymlink (via writeFileUtf8)', () => {
    it('should allow operations when file does not exist (ENOENT)', async () => {
      lstatSpy = spyOn(fsPromises, 'lstat').mockRejectedValue({ code: 'ENOENT' } as any);

      await expect(writeFileUtf8('/fake/path.txt', 'content')).resolves.toBeUndefined();
      expect(lstatSpy).toHaveBeenCalledWith('/fake/path.txt');
      expect(writeFileSpy).toHaveBeenCalledWith('/fake/path.txt', 'content', 'utf-8');
    });

    it('should throw an error when path is a symlink', async () => {
      lstatSpy = spyOn(fsPromises, 'lstat').mockResolvedValue({
        isSymbolicLink: () => true,
      } as any);

      await expect(writeFileUtf8('/fake/path.txt', 'content')).rejects.toThrow(
        'Security Violation: Refusing to follow symlink: /fake/path.txt',
      );
      expect(lstatSpy).toHaveBeenCalledWith('/fake/path.txt');
      expect(writeFileSpy).not.toHaveBeenCalled();
    });

    it('should allow operations when path is a regular file', async () => {
      lstatSpy = spyOn(fsPromises, 'lstat').mockResolvedValue({
        isSymbolicLink: () => false,
      } as any);

      await expect(writeFileUtf8('/fake/path.txt', 'content')).resolves.toBeUndefined();
      expect(lstatSpy).toHaveBeenCalledWith('/fake/path.txt');
      expect(writeFileSpy).toHaveBeenCalledWith('/fake/path.txt', 'content', 'utf-8');
    });

    it('should rethrow unexpected fs errors', async () => {
      const unexpectedError = new Error('EACCES: permission denied');
      (unexpectedError as any).code = 'EACCES';
      lstatSpy = spyOn(fsPromises, 'lstat').mockRejectedValue(unexpectedError);

      await expect(writeFileUtf8('/fake/path.txt', 'content')).rejects.toThrow(
        'EACCES: permission denied',
      );
      expect(lstatSpy).toHaveBeenCalledWith('/fake/path.txt');
      expect(writeFileSpy).not.toHaveBeenCalled();
    });
  });

  describe('assertNotSymlink (via copyFile)', () => {
    it('should allow operations when destination does not exist (ENOENT)', async () => {
      lstatSpy = spyOn(fsPromises, 'lstat').mockRejectedValue({ code: 'ENOENT' } as any);
      spyOn(fsPromises, 'realpath').mockResolvedValue('/fake/from.txt' as any); // mock realpath for assertNoSymlinkEscape

      await expect(copyFile('/fake/from.txt', '/fake/to.txt')).resolves.toBeUndefined();

      expect(copyFileSpy).toHaveBeenCalledWith('/fake/from.txt', '/fake/to.txt');
    });

    it('should throw an error when destination is a symlink', async () => {
      lstatSpy = spyOn(fsPromises, 'lstat').mockResolvedValue({
        isSymbolicLink: () => true,
      } as any);

      await expect(copyFile('/fake/from.txt', '/fake/to.txt')).rejects.toThrow(
        'Security Violation: Refusing to follow symlink: /fake/to.txt',
      );
      expect(copyFileSpy).not.toHaveBeenCalled();
    });
  });
});
