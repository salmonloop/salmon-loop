import * as fs from 'fs/promises';
import * as os from 'os';
import path from 'path';

import mockFs from 'mock-fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactStore } from '../../../../src/core/sub-agent/artifacts/store.js';
import { executeArtifactRead } from '../../../../src/core/tools/builtin/artifact.js';

describe('ArtifactStore', () => {
  afterEach(() => {
    mockFs.restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('saves and reads text artifacts by handle', async () => {
    const tmp = os.tmpdir();
    mockFs({
      [tmp]: {},
    });

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

  it('exposes artifacts through the artifact.read tool', async () => {
    const tmp = os.tmpdir();
    mockFs({
      [tmp]: {},
    });

    const saved = await ArtifactStore.saveText({
      content: 'hello',
      mimeType: 'text/plain',
      fileExt: 'txt',
    });

    const out = await executeArtifactRead({ handle: saved.handle }, {} as any);
    expect(out.content).toBe('hello');
    expect(out.size).toBeGreaterThan(0);
  });

  it('returns not ok for unknown handles', async () => {
    const tmp = os.tmpdir();
    mockFs({
      [tmp]: {},
    });

    const read = await ArtifactStore.readText('s8p://artifact/does-not-exist');
    expect(read.ok).toBe(false);
  });

  it('garbage collects expired artifacts by TTL', async () => {
    const now = Date.now();

    const tmp = os.tmpdir();
    const root = path.join(tmp, 'salmonloop', 'artifacts');

    mockFs({
      [root]: {
        'old.patch': mockFs.file({
          content: 'old',
          mtime: new Date(now - 8 * 24 * 60 * 60 * 1000),
        }),
        'new.patch': mockFs.file({
          content: 'new',
          mtime: new Date(now),
        }),
      },
    });

    const result = await ArtifactStore.gc({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    expect(result.removedFiles).toBe(1);

    const remaining = await fs.readdir(root);
    expect(remaining).toEqual(['new.patch']);
  });

  it('garbage collects artifacts to enforce maxFiles', async () => {
    const now = Date.now();

    const tmp = os.tmpdir();
    const root = path.join(tmp, 'salmonloop', 'artifacts');

    mockFs({
      [root]: {
        'a.patch': mockFs.file({ content: 'a', mtime: new Date(now) }),
        'b.patch': mockFs.file({ content: 'b', mtime: new Date(now - 1) }),
        'c.patch': mockFs.file({ content: 'c', mtime: new Date(now - 2) }),
      },
    });

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
