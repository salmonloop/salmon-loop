const { queryMock, rmMock, accessMock, realpathMock } = (() => ({
  queryMock: mock(),
  rmMock: mock(),
  accessMock: mock(),
  realpathMock: mock(),
}))();

mock.module('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: mock().mockImplementation(() => ({
    query: queryMock,
  })),
}));

mock.module('fs/promises', () => ({
  rm: rmMock,
  access: accessMock,
  realpath: realpathMock,
}));

mock.module('os', () => ({
  tmpdir: () => '/tmp',
}));

import { WorkspaceManager } from '../../../src/core/strata/layers/worktree.js';

describe('WorkspaceManager teardown safety behavior', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    queryMock.mockReset();
    rmMock.mockReset();
    accessMock.mockReset();
    realpathMock.mockReset();

    rmMock.mockResolvedValue(undefined);
    accessMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });

  it('emits skipped status when workPath equals base repo', async () => {
    const events: any[] = [];
    await WorkspaceManager.teardown(
      {
        strategy: 'worktree',
        baseRepoPath: '/repo',
        workPath: '/repo',
      },
      (event) => events.push(event),
    );

    expect(
      events.some((event) => event?.resource === 'worktree' && event?.status === 'skipped'),
    ).toBe(true);
  });

  it('falls back to filesystem cleanup when git worktree removal fails', async () => {
    queryMock.mockRejectedValueOnce(new Error('worktree remove failed'));
    const events: any[] = [];

    await WorkspaceManager.teardown(
      {
        strategy: 'worktree',
        baseRepoPath: '/repo',
        workPath: '/tmp/s8p-wt/repo/test-worktree',
      },
      (event) => events.push(event),
    );

    expect(
      events.some(
        (event) =>
          event?.type === 'action.fallback' &&
          event?.method === 'worktree remove' &&
          event?.severity === 'low',
      ),
    ).toBe(true);
  });

  it('falls back to filesystem cleanup when git reports success but directory still exists', async () => {
    queryMock
      .mockResolvedValueOnce('/tmp/s8p-wt/repo/test-worktree\n') // worktree list
      .mockResolvedValueOnce(''); // worktree remove
    accessMock.mockResolvedValueOnce(undefined); // directory still exists after git removal

    await WorkspaceManager.teardown({
      strategy: 'worktree',
      baseRepoPath: '/repo',
      workPath: '/tmp/s8p-wt/repo/test-worktree',
    });

    expect(rmMock).toHaveBeenCalled();
  });

  it('removes worktree when list path differs but realpath matches', async () => {
    queryMock
      .mockResolvedValueOnce('worktree /private/tmp/s8p-wt/repo/test-worktree\n') // worktree list
      .mockResolvedValueOnce(''); // worktree remove

    realpathMock.mockImplementation(async (p: string) => {
      if (p === '/tmp/s8p-wt/repo/test-worktree') return '/private/tmp/s8p-wt/repo/test-worktree';
      return p;
    });

    accessMock.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    await WorkspaceManager.teardown({
      strategy: 'worktree',
      baseRepoPath: '/repo',
      workPath: '/tmp/s8p-wt/repo/test-worktree',
    });

    expect(realpathMock).toHaveBeenCalledWith('/tmp/s8p-wt/repo/test-worktree');
    expect(realpathMock).toHaveBeenCalledWith('/private/tmp/s8p-wt/repo/test-worktree');
    expect(queryMock).toHaveBeenCalledWith([
      'worktree',
      'remove',
      '--force',
      '/private/tmp/s8p-wt/repo/test-worktree',
    ]);
    expect(rmMock).not.toHaveBeenCalled();
  });

  it('cleans up with fs when worktree is missing from git worktree list', async () => {
    queryMock.mockResolvedValueOnce('/tmp/s8p-wt/repo/another-worktree\n');
    const events: any[] = [];

    await WorkspaceManager.teardown(
      {
        strategy: 'worktree',
        baseRepoPath: '/repo',
        workPath: '/tmp/s8p-wt/repo/missing-worktree',
      },
      (event) => events.push(event),
    );

    expect(
      events.some(
        (event) =>
          event?.type === 'resource.status' &&
          event?.resource === 'worktree' &&
          event?.status === 'warning',
      ),
    ).toBe(true);
  });

  it('refuses fallback deletion outside temp directory', async () => {
    queryMock.mockResolvedValueOnce('');

    await expect(
      WorkspaceManager.teardown({
        strategy: 'worktree',
        baseRepoPath: '/repo',
        workPath: '/unsafe/worktree',
      }),
    ).rejects.toThrow('Worktree path not in temp directory, refusing to delete');
  });
});
