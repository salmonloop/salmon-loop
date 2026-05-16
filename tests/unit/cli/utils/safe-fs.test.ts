import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { readdirDirentsSync } from '../../../../src/cli/utils/safe-fs.js';

describe('readdirDirentsSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fs-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reads directory entries synchronously', () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));

    const entries = readdirDirentsSync(tmpDir);
    expect(entries.length).toBe(2);

    const fileEntry = entries.find((e) => e.name === 'file.txt');
    expect(fileEntry).toBeDefined();
    expect(fileEntry?.isFile()).toBe(true);

    const dirEntry = entries.find((e) => e.name === 'subdir');
    expect(dirEntry).toBeDefined();
    expect(dirEntry?.isDirectory()).toBe(true);
  });

  it('reads directory with a rootContext', () => {
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'content');

    const entries = readdirDirentsSync(tmpDir, tmpDir);
    expect(entries.length).toBe(1);
    expect(entries[0].name).toBe('file.txt');
  });

  it('prevents symlink escape when rootContext is provided', () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fs-outside-'));
    fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');

    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'safe-fs-sandbox-'));

    // Create a symlink in sandbox pointing to outside
    fs.symlinkSync(outsideDir, path.join(sandboxDir, 'escape'));

    try {
      expect(() => readdirDirentsSync(path.join(sandboxDir, 'escape'), sandboxDir)).toThrow();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    }
  });
});
