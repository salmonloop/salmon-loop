import * as fsPromises from 'fs/promises';

import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { writeFileUtf8 } from '../../../../src/cli/utils/safe-fs.js';

describe('cli/utils/safe-fs', () => {
  let lstatSpy: ReturnType<typeof spyOn>;
  let writeFileSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (lstatSpy) lstatSpy.mockRestore();
    if (writeFileSpy) writeFileSpy.mockRestore();
  });

  describe('assertNotSymlink (via writeFileUtf8)', () => {
    it('should allow operations when file does not exist (ENOENT)', async () => {
      lstatSpy = spyOn(fsPromises, 'lstat').mockRejectedValue({ code: 'ENOENT' } as any);
      writeFileSpy = spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined as any);

      await expect(writeFileUtf8('/fake/path.txt', 'content')).resolves.toBeUndefined();
      expect(lstatSpy).toHaveBeenCalledWith('/fake/path.txt');
    });

    it('should throw an error when path is a symlink', async () => {
      lstatSpy = spyOn(fsPromises, 'lstat').mockResolvedValue({
        isSymbolicLink: () => true,
      } as any);
      writeFileSpy = spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined as any);

      await expect(writeFileUtf8('/fake/path.txt', 'content')).rejects.toThrow(
        'Security Violation: Refusing to follow symlink: /fake/path.txt',
      );
      expect(lstatSpy).toHaveBeenCalledWith('/fake/path.txt');
    });

    it('should allow operations when path is a regular file', async () => {
      lstatSpy = spyOn(fsPromises, 'lstat').mockResolvedValue({
        isSymbolicLink: () => false,
      } as any);
      writeFileSpy = spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined as any);

      await expect(writeFileUtf8('/fake/path.txt', 'content')).resolves.toBeUndefined();
      expect(lstatSpy).toHaveBeenCalledWith('/fake/path.txt');
    });

    it('should rethrow unexpected fs errors', async () => {
      const unexpectedError = new Error('EACCES: permission denied');
      (unexpectedError as any).code = 'EACCES';
      lstatSpy = spyOn(fsPromises, 'lstat').mockRejectedValue(unexpectedError);
      writeFileSpy = spyOn(fsPromises, 'writeFile').mockResolvedValue(undefined as any);

      await expect(writeFileUtf8('/fake/path.txt', 'content')).rejects.toThrow(
        'EACCES: permission denied',
      );
      expect(lstatSpy).toHaveBeenCalledWith('/fake/path.txt');
    });
  });
});
