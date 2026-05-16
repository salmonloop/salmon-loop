import * as fsPromises from 'fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';

import { writeFileUtf8 } from '../../../../src/cli/utils/safe-fs.js';

describe('writeFileUtf8', () => {
  afterEach(() => {
    mock.restore();
  });

  it('writes file successfully without root context', async () => {
    const writeMock = spyOn(fsPromises, 'writeFile').mockImplementation(async () => {});
    spyOn(fsPromises, 'lstat').mockImplementation(async () => {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });

    const targetPath = 'dummy.txt';
    const content = 'hello world';

    await writeFileUtf8(targetPath, content);

    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock).toHaveBeenCalledWith(targetPath, content, 'utf-8');
  });

  it('throws error if target is a symlink', async () => {
    const writeMock = spyOn(fsPromises, 'writeFile').mockImplementation(async () => {});
    spyOn(fsPromises, 'lstat').mockImplementation(async () => {
      return {
        isSymbolicLink: () => true,
      } as fs.Stats;
    });

    const targetPath = 'dummy.txt';
    const content = 'hello world';

    await expect(writeFileUtf8(targetPath, content)).rejects.toThrow(
      'Security Violation: Refusing to follow symlink',
    );

    expect(writeMock).not.toHaveBeenCalled();
  });

  it('verifies parent is in sandbox when rootContext is provided', async () => {
    const writeMock = spyOn(fsPromises, 'writeFile').mockImplementation(async () => {});
    spyOn(fsPromises, 'lstat').mockImplementation(async () => {
      const err: any = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    });
    spyOn(fs, 'existsSync').mockReturnValue(true);
    spyOn(fsPromises, 'realpath').mockImplementation(
      async (p: any) => p as string,
    );

    const rootContext = '/sandbox';
    const targetPath = 'safe/file.txt';
    const content = 'hello world';

    await writeFileUtf8(targetPath, content, rootContext);

    expect(writeMock).toHaveBeenCalledTimes(1);
    const expectedResolvedPath = path.resolve('/sandbox/safe/file.txt');
    expect(writeMock).toHaveBeenCalledWith(expectedResolvedPath, content, 'utf-8');
  });

  it('throws error if parent directory escapes sandbox', async () => {
    const writeMock = spyOn(fsPromises, 'writeFile').mockImplementation(async () => {});

    // We do not mock anything except to intercept writeFile, since safe-fs will fail during the initial path resolution phase
    // if a relative path tries to escape the rootContext.

    const rootContext = '/sandbox';
    const targetPath = '../outside/file.txt'; // User tries to write outside
    const content = 'hello world';

    await expect(writeFileUtf8(targetPath, content, rootContext)).rejects.toThrow(
      'Security Violation: Path traversal attempt',
    );
    expect(writeMock).not.toHaveBeenCalled();
  });
});
