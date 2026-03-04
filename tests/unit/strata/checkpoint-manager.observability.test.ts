import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { gitQueryMock, gitExecMock, recordAuditEventMock, rmMock, statMock } = (() => ({
  gitQueryMock: mock(),
  gitExecMock: mock(),
  recordAuditEventMock: mock(),
  rmMock: mock().mockResolvedValue(undefined),
  statMock: mock(),
}))();

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  mkdir: mock(),
  rm: rmMock,
  stat: statMock,
}));

mock.module('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: mock().mockImplementation(() => ({
    query: gitQueryMock,
    exec: gitExecMock,
  })),
}));

mock.module('../../../src/core/observability/audit-trail.js', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';

describe('CheckpointManager observability', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('emits a safe step failure event when read-tree fails', async () => {
    gitQueryMock.mockResolvedValueOnce('staged-tree\n');
    gitExecMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'read-tree') {
        throw Object.assign(new Error('read-tree failed'), { code: 'EACCES' });
      }
      return '';
    });

    const manager = new CheckpointManager();
    await expect(manager.createSafeSnapshot('/repo')).rejects.toThrow('read-tree failed');

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'snapshot.create.step.failed',
      expect.objectContaining({
        step: 'read-tree',
        repoPathHash: expect.any(String),
        includePathsCount: 0,
        errorName: 'Error',
        errorCode: 'EACCES',
        errorHintCode: 'GIT_FAILURE_UNKNOWN',
        errorFingerprint: expect.any(String),
      }),
      expect.any(Object),
    );
  });

  it('classifies known git index lock failures with safe hint code', async () => {
    gitQueryMock.mockResolvedValueOnce('staged-tree\n');
    gitExecMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'read-tree') {
        throw Object.assign(new Error('git failed\nStderr: fatal: Unable to create index.lock'), {
          code: 'GIT_ERROR',
          stderr: 'fatal: Unable to create index.lock: File exists',
          command: 'read-tree staged-tree',
        });
      }
      return '';
    });

    const manager = new CheckpointManager();
    await expect(manager.createSafeSnapshot('/repo')).rejects.toThrow();

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'snapshot.create.step.failed',
      expect.objectContaining({
        step: 'read-tree',
        errorHintCode: 'GIT_INDEX_LOCKED',
        stderrFingerprint: expect.any(String),
        commandFingerprint: expect.any(String),
      }),
      expect.any(Object),
    );
  });

  it('classifies write-tree build errors into a stable hint code', async () => {
    gitQueryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'write-tree') {
        throw Object.assign(
          new Error('git failed\nStderr: fatal: git-write-tree: error building trees'),
          {
            code: 'GIT_ERROR',
            stderr: 'fatal: git-write-tree: error building trees',
            command: 'write-tree',
          },
        );
      }
      return '';
    });

    const manager = new CheckpointManager();
    await expect(manager.createSafeSnapshot('/repo')).rejects.toThrow();

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'snapshot.create.step.failed',
      expect.objectContaining({
        step: 'write-tree',
        errorHintCode: 'GIT_TREE_BUILD_FAILED',
      }),
      expect.any(Object),
    );
  });

  it('classifies generic fatal write-tree failures into write-tree specific hint code', async () => {
    gitQueryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'write-tree') {
        throw Object.assign(new Error('git failed\nStderr: fatal: unable to cache tree'), {
          code: 'GIT_ERROR',
          stderr: 'fatal: unable to cache tree',
          command: 'write-tree',
        });
      }
      return '';
    });

    const manager = new CheckpointManager();
    await expect(manager.createSafeSnapshot('/repo')).rejects.toThrow();

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'snapshot.create.step.failed',
      expect.objectContaining({
        step: 'write-tree',
        errorHintCode: 'GIT_WRITE_TREE_FATAL',
      }),
      expect.any(Object),
    );
  });

  it('captures write-tree probe details after retry exhaustion', async () => {
    gitQueryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'write-tree') {
        throw Object.assign(new Error('fatal write-tree failure'), {
          code: 'GIT_ERROR',
          stderr: 'fatal: unable to cache tree',
          command: 'write-tree',
        });
      }
      return '';
    });
    statMock.mockResolvedValue({ mtimeMs: Date.now() - 5000 } as any);
    gitExecMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'ls-files') return '';
      if (args[0] === 'rev-parse') return 'true\n';
      return '';
    });

    const manager = new CheckpointManager();
    await expect(manager.createSafeSnapshot('/repo')).rejects.toThrow();

    expect(recordAuditEventMock).toHaveBeenCalledWith(
      'snapshot.create.step.failed',
      expect.objectContaining({
        step: 'write-tree',
        writeTreeAttempts: 3,
        indexLockPresent: true,
        isInsideWorkTree: true,
        unmergedCount: 0,
      }),
      expect.any(Object),
    );
  });
});
