import * as os from 'os';

import mockFs from 'mock-fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactStore } from '../../../../src/core/sub-agent/artifacts/store.js';
import { executeArtifactRead } from '../../../../src/core/tools/builtin/artifact.js';

describe('ArtifactStore', () => {
  afterEach(() => {
    mockFs.restore();
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
});
