const { queryMock, rmMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  rmMock: vi.fn(),
}));

vi.mock('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: vi.fn().mockImplementation(() => ({
    query: queryMock,
  })),
}));

vi.mock('fs/promises', () => ({
  rm: rmMock,
}));

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
}));

import { WorkspaceManager } from '../../../src/core/strata/layers/worktree.js';

describe('WorkspaceManager teardown safety behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rmMock.mockResolvedValue(undefined);
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
