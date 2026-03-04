import { beforeEach, describe, expect, it, mock } from 'bun:test';

const {
  mkdirMock,
  openMock,
  readFileMock,
  renameMock,
  statMock,
  unlinkMock,
  writeFileMock,
  getUserCheckpointManifestDirMock,
} = (() => ({
  mkdirMock: mock(),
  openMock: mock(),
  readFileMock: mock(),
  renameMock: mock(),
  statMock: mock(),
  unlinkMock: mock(),
  writeFileMock: mock(),
  getUserCheckpointManifestDirMock: mock(
    (repoPath: string) => `/home/test/.salmonloop/runtime/checkpoints/${repoPath.length}`,
  ),
}))();

mock.module('../../../../src/core/adapters/fs/node-fs.js', () => ({
  mkdir: mkdirMock,
  open: openMock,
  readFile: readFileMock,
  rename: renameMock,
  stat: statMock,
  unlink: unlinkMock,
  writeFile: writeFileMock,
}));

mock.module('../../../../src/core/runtime/paths.js', () => ({
  getUserCheckpointManifestDir: getUserCheckpointManifestDirMock,
}));

import {
  probeCheckpointHandle,
  readCheckpointManifest,
  removeCheckpointHandle,
  upsertCheckpointHandle,
} from '../../../../src/core/checkpoint-domain/manifest-store.js';

describe('checkpoint manifest store', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    openMock.mockResolvedValue({
      writeFile: mock().mockResolvedValue(undefined),
      close: mock().mockResolvedValue(undefined),
    });
    writeFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
    statMock.mockResolvedValue({ mtimeMs: Date.now() } as any);
    unlinkMock.mockResolvedValue(undefined);
  });

  it('returns empty manifest when file is missing', async () => {
    readFileMock.mockRejectedValue(new Error('missing'));

    const manifest = await readCheckpointManifest('/repo');

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.checkpoints).toEqual({});
    expect(manifest.sessions).toEqual({});
  });

  it('upserts checkpoint handle into manifest', async () => {
    readFileMock.mockRejectedValue(new Error('missing'));

    await upsertCheckpointHandle('/repo', {
      id: 'cp-1',
      createdAt: '2026-03-04T00:00:00.000Z',
      strategy: 'worktree',
      backend: 'git_snapshot',
      metadata: { a: 1 },
    });

    expect(writeFileMock).toHaveBeenCalled();
    expect(renameMock).toHaveBeenCalledWith(
      expect.stringContaining('.tmp-'),
      '/home/test/.salmonloop/runtime/checkpoints/5/manifest.v2.json',
    );
  });

  it('falls back to legacy v1 manifest when v2 file is missing', async () => {
    readFileMock
      .mockRejectedValueOnce(Object.assign(new Error('missing-v2'), { code: 'ENOENT' }))
      .mockResolvedValueOnce(
        JSON.stringify({
          schemaVersion: 1,
          checkpoints: {
            'cp-legacy': {
              id: 'cp-legacy',
              createdAt: '2026-03-04T00:00:00.000Z',
              strategy: 'worktree',
              backend: 'git_snapshot',
            },
          },
          sessions: {},
        }),
      );

    const manifest = await readCheckpointManifest('/repo');
    expect(manifest.checkpoints['cp-legacy']?.id).toBe('cp-legacy');
  });

  it('reads v2 manifest shape with lightweight compatibility migration', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 2,
        checkpoints: {
          'cp-2': {
            id: 'cp-2',
            createdAt: '2026-03-04T00:00:00.000Z',
            strategy: 'worktree',
            backend: 'git_snapshot',
          },
        },
        sessions: {},
        checkpointLineage: {
          'cp-2': { parentId: 'cp-1' },
        },
      }),
    );

    const manifest = await readCheckpointManifest('/repo');
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.checkpoints['cp-2']?.id).toBe('cp-2');
  });

  it('removes checkpoint and keeps manifest consistent', async () => {
    readFileMock.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        checkpoints: {
          'cp-1': {
            id: 'cp-1',
            createdAt: '2026-03-04T00:00:00.000Z',
            strategy: 'worktree',
            backend: 'git_snapshot',
          },
        },
        sessions: {
          sess1: {
            sessionId: 'sess1',
            currentCheckpointId: 'cp-1',
            history: ['cp-1'],
          },
        },
      }),
    );

    await removeCheckpointHandle('/repo', 'cp-1');

    expect(renameMock).toHaveBeenCalled();
  });

  it('returns manifest_unavailable when manifest file cannot be parsed', async () => {
    readFileMock.mockResolvedValue('{ not-json');
    const result = await probeCheckpointHandle('/repo', 'cp-any');
    expect(result.reason).toBe('manifest_unavailable');
  });

  it('reclaims stale manifest lock before writing', async () => {
    openMock
      .mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'EEXIST' }))
      .mockResolvedValueOnce({
        writeFile: mock().mockResolvedValue(undefined),
        close: mock().mockResolvedValue(undefined),
      });
    readFileMock.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('.manifest.lock')) {
        return JSON.stringify({ createdAtMs: Date.now() - 1000 * 60 });
      }
      throw Object.assign(new Error('missing manifest'), { code: 'ENOENT' });
    });

    await upsertCheckpointHandle('/repo', {
      id: 'cp-lock',
      createdAt: '2026-03-04T00:00:00.000Z',
      strategy: 'worktree',
      backend: 'git_snapshot',
    });

    expect(unlinkMock).toHaveBeenCalledWith(
      '/home/test/.salmonloop/runtime/checkpoints/5/.manifest.lock',
    );
  });

  it('reclaims corrupted stale lock payload using lock mtime fallback', async () => {
    openMock
      .mockRejectedValueOnce(Object.assign(new Error('exists'), { code: 'EEXIST' }))
      .mockResolvedValueOnce({
        writeFile: mock().mockResolvedValue(undefined),
        close: mock().mockResolvedValue(undefined),
      });
    readFileMock.mockImplementation(async (targetPath: string) => {
      if (targetPath.endsWith('.manifest.lock')) {
        return '{ invalid-json';
      }
      throw Object.assign(new Error('missing manifest'), { code: 'ENOENT' });
    });
    statMock.mockResolvedValueOnce({ mtimeMs: Date.now() - 1000 * 90 } as any);

    await upsertCheckpointHandle('/repo', {
      id: 'cp-corrupt-lock',
      createdAt: '2026-03-04T00:00:00.000Z',
      strategy: 'worktree',
      backend: 'git_snapshot',
    });

    expect(unlinkMock).toHaveBeenCalledWith(
      '/home/test/.salmonloop/runtime/checkpoints/5/.manifest.lock',
    );
  });
});
