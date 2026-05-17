import { beforeEach, describe, expect, it, mock } from 'bun:test';

const {
  garbageCollectManifestMock,
  linkSessionToCheckpointMock,
  probeCheckpointHandleMock,
  readCheckpointManifestMock,
  removeCheckpointHandleMock,
  upsertCheckpointHandleMock,
} = (() => ({
  garbageCollectManifestMock: mock(),
  linkSessionToCheckpointMock: mock(),
  probeCheckpointHandleMock: mock(),
  readCheckpointManifestMock: mock(),
  removeCheckpointHandleMock: mock(),
  upsertCheckpointHandleMock: mock(),
}))();

mock.module('../../../../src/core/checkpoint-domain/manifest-store.js', () => ({
  garbageCollectManifest: garbageCollectManifestMock,
  linkSessionToCheckpoint: linkSessionToCheckpointMock,
  probeCheckpointHandle: probeCheckpointHandleMock,
  readCheckpointManifest: readCheckpointManifestMock,
  removeCheckpointHandle: removeCheckpointHandleMock,
  upsertCheckpointHandle: upsertCheckpointHandleMock,
}));

import { GitSnapshotCheckpointService } from '../../../../src/core/checkpoint-domain/service.js';

describe('GitSnapshotCheckpointService', () => {
  beforeEach(() => {
    garbageCollectManifestMock.mockResolvedValue({ removed: 0, removedIds: [] });
    probeCheckpointHandleMock.mockResolvedValue({ handle: null, reason: 'not_found' });
  });

  it('creates checkpoint handle and links session', async () => {
    const manager = {
      createSafeSnapshot: mock().mockResolvedValue({ commitHash: 'cp-123', stagedTree: 'tree-1' }),
      deleteSnapshot: mock().mockResolvedValue(undefined),
    } as any;
    const service = new GitSnapshotCheckpointService(manager);

    const handle = await service.create({
      repoPath: '/repo',
      strategy: 'worktree',
      sessionId: 'sess-1',
    });

    expect(handle.id).toBe('cp-123');
    expect(upsertCheckpointHandleMock).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ id: 'cp-123' }),
      undefined,
    );
    expect(linkSessionToCheckpointMock).toHaveBeenCalledWith(
      '/repo',
      'sess-1',
      'cp-123',
      undefined,
    );
  });

  it('lists checkpoints for session history', async () => {
    readCheckpointManifestMock.mockResolvedValue({
      schemaVersion: 1,
      checkpoints: {
        'cp-1': {
          id: 'cp-1',
          createdAt: '2026-03-04T10:00:00.000Z',
          strategy: 'worktree',
          backend: 'git_snapshot',
        },
        'cp-2': {
          id: 'cp-2',
          createdAt: '2026-03-04T11:00:00.000Z',
          strategy: 'worktree',
          backend: 'git_snapshot',
        },
      },
      sessions: {
        'sess-1': { sessionId: 'sess-1', currentCheckpointId: 'cp-2', history: ['cp-1', 'cp-2'] },
      },
    });
    const manager = {
      createSafeSnapshot: mock(),
      deleteSnapshot: mock(),
    } as any;
    const service = new GitSnapshotCheckpointService(manager);

    const items = await service.list({ repoPath: '/repo', sessionId: 'sess-1' });

    expect(items.map((item) => item.id)).toEqual(['cp-2', 'cp-1']);
  });

  it('deletes checkpoint from backend and manifest', async () => {
    const deleteSnapshot = mock().mockResolvedValue(undefined);
    const manager = {
      createSafeSnapshot: mock(),
      deleteSnapshot,
    } as any;
    const service = new GitSnapshotCheckpointService(manager);

    await service.delete({ repoPath: '/repo', checkpointId: 'cp-1' });

    expect(deleteSnapshot).toHaveBeenCalledWith('/repo', 'cp-1');
    expect(removeCheckpointHandleMock).toHaveBeenCalledWith('/repo', 'cp-1', undefined);
  });

  it('reconciles git snapshot refs for garbage-collected manifest ids', async () => {
    garbageCollectManifestMock.mockResolvedValue({
      removed: 2,
      removedIds: ['cp-1', 'cp-2'],
    });
    const deleteSnapshot = mock().mockResolvedValue(undefined);
    const manager = {
      createSafeSnapshot: mock(),
      deleteSnapshot,
    } as any;
    const service = new GitSnapshotCheckpointService(manager);

    const result = await service.gc({ repoPath: '/repo' });

    expect(garbageCollectManifestMock).toHaveBeenCalledWith(
      '/repo',
      { olderThanMs: undefined, maxPerSession: undefined },
      undefined,
    );
    expect(deleteSnapshot).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ removed: 2, refsRemoved: 2 });
  });

  it('passes configured lock policy to manifest operations', async () => {
    const manager = {
      createSafeSnapshot: mock().mockResolvedValue({ commitHash: 'cp-xyz', stagedTree: 'tree-z' }),
      deleteSnapshot: mock().mockResolvedValue(undefined),
    } as any;
    const service = new GitSnapshotCheckpointService(manager, {
      lockStaleMs: 45000,
      lockHeartbeatMs: 3000,
    });

    await service.create({
      repoPath: '/repo',
      strategy: 'worktree',
      sessionId: 'sess-1',
    });
    await service.delete({ repoPath: '/repo', checkpointId: 'cp-xyz' });
    await service.gc({ repoPath: '/repo', olderThanMs: 1000, maxPerSession: 10 });

    expect(upsertCheckpointHandleMock).toHaveBeenCalledWith(
      '/repo',
      expect.objectContaining({ id: 'cp-xyz' }),
      { lockStaleMs: 45000, lockHeartbeatMs: 3000 },
    );
    expect(linkSessionToCheckpointMock).toHaveBeenCalledWith('/repo', 'sess-1', 'cp-xyz', {
      lockStaleMs: 45000,
      lockHeartbeatMs: 3000,
    });
    expect(removeCheckpointHandleMock).toHaveBeenCalledWith('/repo', 'cp-xyz', {
      lockStaleMs: 45000,
      lockHeartbeatMs: 3000,
    });
    expect(garbageCollectManifestMock).toHaveBeenCalledWith(
      '/repo',
      { olderThanMs: 1000, maxPerSession: 10 },
      { lockStaleMs: 45000, lockHeartbeatMs: 3000 },
    );
  });
});
