import path from 'node:path';

import { describe, it, expect } from 'bun:test';

import { safePathJoin } from '../../../../src/cli/utils/safe-fs.js';

describe('safePathJoin', () => {
  it('should join paths correctly within the root directory', () => {
    const root = '/var/sandbox';
    const result = safePathJoin(root, 'subdir', 'file.txt');
    expect(result).toBe(path.resolve('/var/sandbox/subdir/file.txt'));
  });

  it('should allow resolving upwards as long as it stays within the root', () => {
    const root = '/var/sandbox';
    const result = safePathJoin(root, 'subdir', '..', 'file.txt');
    expect(result).toBe(path.resolve('/var/sandbox/file.txt'));
  });

  it('should throw an error when a path traverses outside the root directory', () => {
    const root = '/var/sandbox';
    expect(() => safePathJoin(root, '..', 'etc', 'passwd')).toThrow(/Security Violation/);
  });

  it('should throw an error when attempting to access a peer directory via string manipulation', () => {
    const root = '/var/sandbox';
    // Accessing /var/sandbox2
    expect(() => safePathJoin(root, '..', 'sandbox2')).toThrow(/Security Violation/);
  });

  it('should handle absolute parts that resolve within the root', () => {
    const root = '/var/sandbox';
    const result = safePathJoin(root, '/subdir');
    expect(result).toBe(path.resolve('/var/sandbox/subdir'));
  });

  it('should handle edge case of empty parts', () => {
    const root = '/var/sandbox';
    const result = safePathJoin(root);
    expect(result).toBe(path.resolve(root));
  });

  it('should work when parts contains an empty string', () => {
    const root = '/var/sandbox';
    const result = safePathJoin(root, '', 'subdir', '');
    expect(result).toBe(path.resolve('/var/sandbox/subdir'));
  });
});
