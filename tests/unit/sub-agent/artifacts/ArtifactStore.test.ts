import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let sandboxTmpDir = '';
const originalTmpdir = os.tmpdir;

mock.module('os', () => ({
  tmpdir: () => sandboxTmpDir || originalTmpdir(),
}));

import { ArtifactStore } from '../../../../src/core/sub-agent/artifacts/store.js';
import { executeArtifactRead } from '../../../../src/core/tools/builtin/artifact.js';

describe('ArtifactStore', () => {
  beforeEach(async () => {
    sandboxTmpDir = await fs.mkdtemp(path.join(originalTmpdir(), 'sl-artifacts-'));
  });

  afterEach(async () => {
    await fs.rm(sandboxTmpDir, { recursive: true, force: true });
    sandboxTmpDir = '';
  });

  test('saves and reads text artifacts by handle', async () => {
    const saved = await ArtifactStore.saveText({
      content: 'diff --git a/a b/b',
      mimeType: 'text/x-diff',
      fileExt: 'patch',
    });

    const read = await ArtifactStore.readText(saved.handle);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.content).toBe('diff --git a/a b/b');
      expect(read.size).toBeGreaterThan(0);
    }
  });

  test('exposes artifacts through the artifact.read tool', async () => {
    const saved = await ArtifactStore.saveText({
      content: 'hello',
      mimeType: 'text/plain',
      fileExt: 'txt',
    });

    const out = await executeArtifactRead({ handle: saved.handle }, {} as any);
    expect(out.content).toBe('hello');
    expect(out.size).toBeGreaterThan(0);
  });

  test('returns not ok for unknown handles', async () => {
    const read = await ArtifactStore.readText('s8p://artifact/does-not-exist');
    expect(read.ok).toBe(false);
  });

  test('garbage collects expired artifacts by TTL', async () => {
    const now = Date.now();
    const root = path.join(sandboxTmpDir, 'salmonloop', 'artifacts');
    const oldFile = path.join(root, 'old.patch');
    const newFile = path.join(root, 'new.patch');

    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(oldFile, 'old', 'utf8');
    await fs.writeFile(newFile, 'new', 'utf8');
    await fs.utimes(
      oldFile,
      new Date(now - 8 * 24 * 60 * 60 * 1000),
      new Date(now - 8 * 24 * 60 * 60 * 1000),
    );
    await fs.utimes(newFile, new Date(now), new Date(now));

    const result = await ArtifactStore.gc({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    expect(result.removedFiles).toBe(1);

    const remaining = await fs.readdir(root);
    expect(remaining).toEqual(['new.patch']);
  });

  test('garbage collects artifacts to enforce maxFiles', async () => {
    const now = Date.now();
    const root = path.join(sandboxTmpDir, 'salmonloop', 'artifacts');
    const fileA = path.join(root, 'a.patch');
    const fileB = path.join(root, 'b.patch');
    const fileC = path.join(root, 'c.patch');

    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(fileA, 'a', 'utf8');
    await fs.writeFile(fileB, 'b', 'utf8');
    await fs.writeFile(fileC, 'c', 'utf8');
    await fs.utimes(fileA, new Date(now), new Date(now));
    await fs.utimes(fileB, new Date(now - 1), new Date(now - 1));
    await fs.utimes(fileC, new Date(now - 2), new Date(now - 2));

    const result = await ArtifactStore.gc({
      maxAgeMs: 365 * 24 * 60 * 60 * 1000,
      maxFiles: 1,
      maxTotalBytes: 1024 * 1024,
    });
    expect(result.removedFiles).toBe(2);

    const remaining = await fs.readdir(root);
    expect(remaining).toEqual(['a.patch']);
  });
});
