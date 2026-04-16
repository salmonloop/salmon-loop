import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { isWithinRoot } from '../../../../src/core/extensions/paths.js';

describe('isWithinRoot', () => {
  let root: string;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'isWithinRoot-'));
    await fsp.mkdir(path.join(root, 'sub', 'deep'), { recursive: true });
    await fsp.writeFile(path.join(root, 'sub', 'file.txt'), 'test');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('returns true for a direct child path', () => {
    expect(isWithinRoot(path.join(root, 'sub'), root)).toBe(true);
  });

  it('returns true for a deeply nested path', () => {
    expect(isWithinRoot(path.join(root, 'sub', 'deep'), root)).toBe(true);
  });

  it('returns true when candidate equals root', () => {
    expect(isWithinRoot(root, root)).toBe(true);
  });

  it('returns false for a path outside root', () => {
    expect(isWithinRoot(os.tmpdir(), root)).toBe(false);
  });

  it('returns false for a path traversal escape (..)', () => {
    expect(isWithinRoot(path.join(root, 'sub', '..', '..'), root)).toBe(false);
  });

  it('returns true when candidate path does not exist but is lexically within root', () => {
    // Non-existent paths are allowed via lexical fallback to support pre-declaring
    // skill directories before they are created.
    expect(isWithinRoot(path.join(root, 'nonexistent', 'ghost'), root)).toBe(true);
  });

  it('returns false when root path does not exist', () => {
    expect(isWithinRoot(root, path.join(root, 'nonexistent-root'))).toBe(false);
  });

  it('detects symlink-based escape', async () => {
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'outside-'));
    try {
      const linkPath = path.join(root, 'escape-link');
      await fsp.symlink(outside, linkPath, 'junction');
      expect(isWithinRoot(linkPath, root)).toBe(false);
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  it('allows symlink that resolves within root', async () => {
    const linkPath = path.join(root, 'internal-link');
    await fsp.symlink(path.join(root, 'sub'), linkPath, 'junction');
    expect(isWithinRoot(linkPath, root)).toBe(true);
  });
});
