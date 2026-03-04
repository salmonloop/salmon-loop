import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { mkdirMock, readFileMock, renameMock, writeFileMock, getUserCheckpointManifestDirMock } =
  (() => ({
    mkdirMock: mock(),
    readFileMock: mock(),
    renameMock: mock(),
    writeFileMock: mock(),
    getUserCheckpointManifestDirMock: mock(
      (repoPath: string) => `/home/test/.salmonloop/runtime/checkpoints/${repoPath.length}`,
    ),
  }))();

mock.module('../../../../src/core/adapters/fs/node-fs.js', () => ({
  mkdir: mkdirMock,
  readFile: readFileMock,
  rename: renameMock,
  writeFile: writeFileMock,
}));

mock.module('../../../../src/core/runtime/paths.js', () => ({
  getUserCheckpointManifestDir: getUserCheckpointManifestDirMock,
}));

import {
  readCheckpointManifest,
  removeCheckpointHandle,
  upsertCheckpointHandle,
} from '../../../../src/core/checkpoint-domain/manifest-store.js';

describe('checkpoint manifest store', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    renameMock.mockResolvedValue(undefined);
  });

  it('returns empty manifest when file is missing', async () => {
    readFileMock.mockRejectedValue(new Error('missing'));

    const manifest = await readCheckpointManifest('/repo');

    expect(manifest.schemaVersion).toBe(1);
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
      '/home/test/.salmonloop/runtime/checkpoints/5/manifest.v1.json',
    );
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
    expect(manifest.schemaVersion).toBe(1);
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
});
