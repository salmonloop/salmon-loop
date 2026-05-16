import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, mock, afterEach, spyOn } from 'bun:test';

import * as safeFs from '../../../../src/cli/utils/safe-fs.js';

describe('safe-fs', () => {
  afterEach(() => {
    mock.restore();
  });

  describe('resolveRealRootSync fallback', () => {
    it('should fallback to path.resolve when fs.realpathSync throws', () => {
      // Mock existsSync so that existsSync(resolved) returns true and the rest of the function runs
      spyOn(fs, 'existsSync').mockReturnValue(true);

      const realpathSyncSpy = spyOn(fs, 'realpathSync').mockImplementation((p: string | Buffer | URL) => {
        // We throw only for the rootContext.
        // It's used in assertNoSymlinkEscapeSync via resolveRealRootSync
        if (p === '/fake/root') {
          throw new Error('ENOENT');
        }
        return String(p); // allow other calls (like the target path)
      });

      // safeFs.existsSync calls resolveRealRootSync inside assertNoSymlinkEscapeSync
      const result = safeFs.existsSync('/fake/root/file.txt', '/fake/root');

      expect(result).toBe(true);

      // Verify realpathSync was called
      expect(realpathSyncSpy).toHaveBeenCalled();
    });
  });
});
