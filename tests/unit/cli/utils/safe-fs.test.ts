import fs from 'node:fs';

import { describe, it, expect, mock } from 'bun:test';

import * as safeFs from '../../../../src/cli/utils/safe-fs.js';

describe('safe-fs existsSync', () => {
  it('returns true if file exists', () => {
    // package.json exists in the project root
    expect(safeFs.existsSync('package.json')).toBe(true);
  });

  it('returns false if file does not exist', () => {
    expect(safeFs.existsSync('non-existent-file.txt')).toBe(false);
  });

  it('returns false on error (e.g., from fs.existsSync throwing)', () => {
    const originalExistsSync = fs.existsSync;
    fs.existsSync = mock(() => {
      throw new Error('Mocked error');
    }) as any;

    try {
      expect(safeFs.existsSync('package.json')).toBe(false);
    } finally {
      fs.existsSync = originalExistsSync;
    }
  });

  it('returns false if sandbox escape is attempted', () => {
    expect(safeFs.existsSync('../../../../../etc/passwd', '/some/safe/dir')).toBe(false);
  });
});
