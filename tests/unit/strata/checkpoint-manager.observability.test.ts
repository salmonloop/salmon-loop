import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { gitQueryMock, gitExecMock, recordAuditEventMock, rmMock } = (() => ({
  gitQueryMock: mock(),
  gitExecMock: mock(),
  recordAuditEventMock: mock(),
  rmMock: mock().mockResolvedValue(undefined),
}))();

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  mkdir: mock(),
  rm: rmMock,
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
      }),
      expect.any(Object),
    );
  });
});
