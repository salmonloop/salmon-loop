import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';

import { readdirDirents, readdirDirentsSync } from '../../../../src/cli/utils/safe-fs.js';

describe('safe-fs: readdirDirents', () => {
  let tmpDir: string;
  let rootContext: string;
  let outOfBoundsDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fs-test-'));
    rootContext = path.join(tmpDir, 'root');
    outOfBoundsDir = path.join(tmpDir, 'out');

    fs.mkdirSync(rootContext);
    fs.mkdirSync(outOfBoundsDir);

    // Create a regular file
    fs.writeFileSync(path.join(rootContext, 'file.txt'), 'hello');

    // Create a subdirectory
    fs.mkdirSync(path.join(rootContext, 'subdir'));

    // Create an out-of-bounds symlink (escapes sandbox)
    fs.symlinkSync(outOfBoundsDir, path.join(rootContext, 'escape-link'));

    // Create a safe symlink
    fs.symlinkSync(path.join(rootContext, 'file.txt'), path.join(rootContext, 'safe-link'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readdirDirents should return Dirents for a valid directory', async () => {
    const dirents = await readdirDirents(rootContext, rootContext);
    expect(dirents.length).toBeGreaterThan(0);

    const names = dirents.map((d) => d.name);
    expect(names).toContain('file.txt');
    expect(names).toContain('subdir');

    // Verify dirent types
    const fileDirent = dirents.find((d) => d.name === 'file.txt');
    expect(fileDirent?.isFile()).toBe(true);
    expect(fileDirent?.isDirectory()).toBe(false);

    const dirDirent = dirents.find((d) => d.name === 'subdir');
    expect(dirDirent?.isDirectory()).toBe(true);
    expect(dirDirent?.isFile()).toBe(false);
  });

  it('readdirDirentsSync should return Dirents for a valid directory', () => {
    const dirents = readdirDirentsSync(rootContext, rootContext);
    expect(dirents.length).toBeGreaterThan(0);

    const names = dirents.map((d) => d.name);
    expect(names).toContain('file.txt');
    expect(names).toContain('subdir');

    // Verify dirent types
    const fileDirent = dirents.find((d) => d.name === 'file.txt');
    expect(fileDirent?.isFile()).toBe(true);

    const dirDirent = dirents.find((d) => d.name === 'subdir');
    expect(dirDirent?.isDirectory()).toBe(true);
  });

  it('readdirDirents should throw on symlink escape when reading an out-of-bounds directory', async () => {
    await expect(
      readdirDirents(path.join(rootContext, 'escape-link'), rootContext),
    ).rejects.toThrow();
  });

  it('readdirDirentsSync should throw on symlink escape when reading an out-of-bounds directory', () => {
    expect(() => readdirDirentsSync(path.join(rootContext, 'escape-link'), rootContext)).toThrow();
  });

  it('readdirDirents should work correctly without a rootContext', async () => {
    const dirents = await readdirDirents(rootContext);
    expect(dirents.length).toBeGreaterThan(0);
    const names = dirents.map((d) => d.name);
    expect(names).toContain('file.txt');
  });

  it('readdirDirentsSync should work correctly without a rootContext', () => {
    const dirents = readdirDirentsSync(rootContext);
    expect(dirents.length).toBeGreaterThan(0);
    const names = dirents.map((d) => d.name);
    expect(names).toContain('file.txt');
  });
});
