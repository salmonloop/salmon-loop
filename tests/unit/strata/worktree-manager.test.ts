import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { setLogger } from '../../../src/core/observability/logger.js';
import { WorkspaceManager } from '../../../src/core/strata/layers/worktree.js';

const { queryMock, rmMock, accessMock, realpathMock, readdirMock, existsSyncMock } = (() => ({
  queryMock: mock(),
  rmMock: mock(),
  accessMock: mock(),
  realpathMock: mock(),
  readdirMock: mock(),
  existsSyncMock: mock(),
}))();

mock.module('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: mock().mockImplementation(() => ({
    query: queryMock,
  })),
}));

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  rm: rmMock,
  access: accessMock,
  realpath: realpathMock,
  readdir: readdirMock,
  existsSync: existsSyncMock,
}));

mock.module('os', () => ({
  tmpdir: () => '/tmp',
}));

describe('WorkspaceManager teardown safety behavior', () => {
  beforeEach(() => {
    mock.restore();
    queryMock.mockReset();
    rmMock.mockReset();
    accessMock.mockReset();
    realpathMock.mockReset();
    readdirMock.mockReset();
    existsSyncMock.mockReset();

    rmMock.mockResolvedValue(undefined);
    accessMock.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    readdirMock.mockResolvedValue([]);
    existsSyncMock.mockReturnValue(false);

    setLogger({
      error: mock(),
      warn: mock(),
      info: mock(),
      success: mock(),
      debug: mock(),
      setReporter: mock(),
    } as any);
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

  it('creates strict-mode worktree paths under system temp root', async () => {
    queryMock.mockResolvedValueOnce('base-ref\n').mockResolvedValueOnce('');

    const workspace = await WorkspaceManager.setup({
      instruction: 'test',
      verify: 'echo ok',
      repoPath: '/repo/my-project',
      strategy: 'worktree',
      environmentMode: 'strict',
    } as any);

    expect(workspace.environmentMode).toBe('strict');
    expect(workspace.workPath.replace(/\\/g, '/')).toContain('/tmp/s8p-wt/my-project/');
  });

  it('creates parity-mode worktree paths under repo-parent parity root', async () => {
    queryMock.mockResolvedValueOnce('base-ref\n').mockResolvedValueOnce('');

    const workspace = await WorkspaceManager.setup({
      instruction: 'test',
      verify: 'echo ok',
      repoPath: '/home/test/projects/my-project',
      strategy: 'worktree',
      environmentMode: 'parity',
    } as any);

    expect(workspace.environmentMode).toBe('parity');
    expect(workspace.workPath.replace(/\\/g, '/')).toContain(
      '/home/test/projects/.salmonloop/worktrees/my-project/',
    );
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

  it('removes projected dependency roots before invoking git worktree remove', async () => {
    queryMock
      .mockResolvedValueOnce('worktree /tmp/s8p-wt/repo/test-worktree\n') // worktree list
      .mockResolvedValueOnce(''); // worktree remove

    readdirMock.mockResolvedValueOnce([{ name: '.git' }, { name: 'node_modules' }] as any);
    existsSyncMock.mockImplementation((p: string) => {
      const normalized = String(p).replace(/\\/g, '/');
      return normalized === '/repo/package.json' || normalized === '/repo/node_modules';
    });

    realpathMock.mockImplementation(async (p: string) => {
      if (p === '/tmp/s8p-wt/repo/test-worktree') return '/tmp/s8p-wt/repo/test-worktree';
      if (p === '/tmp/s8p-wt/repo/test-worktree/node_modules') return '/repo/node_modules';
      return p;
    });

    await WorkspaceManager.teardown({
      strategy: 'worktree',
      baseRepoPath: '/repo',
      workPath: '/tmp/s8p-wt/repo/test-worktree',
    });

    expect(
      rmMock.mock.calls.some(
        ([targetPath, options]) =>
          String(targetPath).replace(/\\/g, '/') ===
            '/tmp/s8p-wt/repo/test-worktree/node_modules' &&
          JSON.stringify(options) ===
            JSON.stringify({
              recursive: true,
              force: true,
              maxRetries: 3,
              retryDelay: 100,
            }),
      ),
    ).toBe(true);
    expect(queryMock).toHaveBeenCalledWith([
      'worktree',
      'remove',
      '--force',
      '/tmp/s8p-wt/repo/test-worktree',
    ]);
  });

  it('falls back to fs cleanup when projected-entry scan cannot resolve the worktree path', async () => {
    queryMock.mockResolvedValueOnce('worktree /tmp/s8p-wt/repo/test-worktree\n');

    realpathMock.mockImplementation(async (p: string) => {
      if (p === '/tmp/s8p-wt/repo/test-worktree') {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      }
      return p;
    });

    await WorkspaceManager.teardown({
      strategy: 'worktree',
      baseRepoPath: '/repo',
      workPath: '/tmp/s8p-wt/repo/test-worktree',
    });

    expect(
      queryMock.mock.calls.some(
        (call) =>
          JSON.stringify(call[0]) ===
          JSON.stringify(['worktree', 'remove', '--force', '/tmp/s8p-wt/repo/test-worktree']),
      ),
    ).toBe(false);
    expect(rmMock).toHaveBeenCalledWith('/tmp/s8p-wt/repo/test-worktree', {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  it('falls back to fs cleanup when projected-entry scan cannot read the worktree directory', async () => {
    queryMock.mockResolvedValueOnce('worktree /tmp/s8p-wt/repo/test-worktree\n');
    realpathMock.mockResolvedValue('/tmp/s8p-wt/repo/test-worktree');
    readdirMock.mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }));

    await WorkspaceManager.teardown({
      strategy: 'worktree',
      baseRepoPath: '/repo',
      workPath: '/tmp/s8p-wt/repo/test-worktree',
    });

    expect(
      queryMock.mock.calls.some(
        (call) =>
          JSON.stringify(call[0]) ===
          JSON.stringify(['worktree', 'remove', '--force', '/tmp/s8p-wt/repo/test-worktree']),
      ),
    ).toBe(false);
    expect(rmMock).toHaveBeenCalledWith('/tmp/s8p-wt/repo/test-worktree', {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
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

  it('allows fallback cleanup under parity worktree root', async () => {
    queryMock.mockResolvedValueOnce('');

    await WorkspaceManager.teardown({
      strategy: 'worktree',
      baseRepoPath: '/home/test/projects/my-project',
      workPath: '/home/test/projects/.salmonloop/worktrees/my-project/test-worktree',
      environmentMode: 'parity',
    });

    expect(rmMock).toHaveBeenCalled();
  });

  it('accepts darwin /private temp aliases as managed worktree roots', async () => {
    const originalPlatform = process.platform;
    queryMock.mockResolvedValueOnce('');

    try {
      Object.defineProperty(process, 'platform', { value: 'darwin' });

      await WorkspaceManager.teardown({
        strategy: 'worktree',
        baseRepoPath: '/repo',
        workPath: '/private/tmp/s8p-wt/repo/test-worktree',
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }

    expect(rmMock).toHaveBeenCalledWith('/private/tmp/s8p-wt/repo/test-worktree', {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  });

  it('refuses fallback deletion outside temp directory', async () => {
    queryMock.mockResolvedValueOnce('');

    await expect(
      WorkspaceManager.teardown({
        strategy: 'worktree',
        baseRepoPath: '/repo',
        workPath: '/unsafe/worktree',
      }),
    ).rejects.toThrow('Worktree path not in managed roots, refusing to delete');
  });

  it('refuses unmanaged worktree paths before pruning dependency roots', async () => {
    queryMock.mockResolvedValueOnce('');
    existsSyncMock.mockImplementation((p: string) => {
      const normalized = String(p).replace(/\\/g, '/');
      return normalized === '/repo/package.json' || normalized === '/repo/node_modules';
    });

    await expect(
      WorkspaceManager.teardown({
        strategy: 'worktree',
        baseRepoPath: '/repo',
        workPath: '/unsafe/worktree',
      }),
    ).rejects.toThrow('Worktree path not in managed roots, refusing to delete');

    expect(rmMock).not.toHaveBeenCalled();
  });

  it('refuses fallback deletion for temp-prefix path outside temp directory', async () => {
    queryMock.mockResolvedValueOnce('');

    await expect(
      WorkspaceManager.teardown({
        strategy: 'worktree',
        baseRepoPath: '/repo',
        workPath: '/tmp-evil/worktree',
      }),
    ).rejects.toThrow('Worktree path not in managed roots, refusing to delete');
  });
});
