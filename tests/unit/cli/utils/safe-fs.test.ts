import * as fsPromises from 'fs/promises';
import fs from 'node:fs';

import { describe, expect, it, spyOn } from 'bun:test';

import { existsSync, stat } from '../../../../src/cli/utils/safe-fs.js';

describe('safe-fs fallback', () => {
  it('should fallback to path.resolve when fs.realpathSync throws', () => {
    const realpathSyncMock = spyOn(fs, 'realpathSync').mockImplementation(((p: fs.PathLike) => {
      if (p === '/does-not-exist-root') {
        throw new Error('mock error');
      }
      return '/does-not-exist-root/file.txt';
    }) as any);

    const existsSyncMock = spyOn(fs, 'existsSync').mockReturnValue(true);

    const result = existsSync('/does-not-exist-root/file.txt', '/does-not-exist-root');
    expect(result).toBe(true);

    expect(realpathSyncMock).toHaveBeenCalled();
    realpathSyncMock.mockRestore();
    existsSyncMock.mockRestore();
  });

  it('should fallback to path.resolve when fsPromises.realpath throws', async () => {
    const realpathMock = spyOn(fsPromises, 'realpath').mockImplementation(((p: fs.PathLike) => {
      if (p === '/does-not-exist-root') {
        return Promise.reject(new Error('mock error'));
      }
      return Promise.resolve('/does-not-exist-root/file.txt');
    }) as any);

    const statMock = spyOn(fsPromises, 'stat').mockResolvedValue({
      isFile: () => true,
    } as any);

    const result = await stat('/does-not-exist-root/file.txt', '/does-not-exist-root');
    expect(result.isFile()).toBe(true);

    expect(realpathMock).toHaveBeenCalled();
    realpathMock.mockRestore();
    statMock.mockRestore();
  });
});
