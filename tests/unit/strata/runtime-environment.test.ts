import { beforeEach, describe, expect, it, mock } from 'bun:test';

const {
  migrateLegacyRuntimeMock,
  createSafeSnapshotMock,
  restoreToShadowMock,
  deleteSnapshotMock,
  workspaceSetupMock,
  workspaceTeardownMock,
  hydrateMock,
  gitQueryMock,
  gitExecMetaMock,
} = (() => ({
  migrateLegacyRuntimeMock: mock().mockResolvedValue(undefined),
  createSafeSnapshotMock: mock(),
  restoreToShadowMock: mock().mockResolvedValue(undefined),
  deleteSnapshotMock: mock().mockResolvedValue(undefined),
  workspaceSetupMock: mock(),
  workspaceTeardownMock: mock().mockResolvedValue(undefined),
  hydrateMock: mock().mockResolvedValue(undefined),
  gitQueryMock: mock(),
  gitExecMetaMock: mock(),
}))();

mock.module('../../../src/core/runtime/paths.js', () => ({
  migrateLegacyRuntime: migrateLegacyRuntimeMock,
}));

mock.module('../../../src/core/llm/errors.js', () => ({
  sanitizeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

mock.module('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: mock().mockImplementation(() => ({
    query: gitQueryMock,
    execMeta: gitExecMetaMock,
  })),
}));

mock.module('../../../src/core/strata/checkpoint/manager.js', () => ({
  CheckpointManager: mock().mockImplementation(() => ({
    createSafeSnapshot: createSafeSnapshotMock,
    restoreToShadow: restoreToShadowMock,
    deleteSnapshot: deleteSnapshotMock,
  })),
}));

mock.module('../../../src/core/checkpoint-domain/service.js', () => ({
  GitSnapshotCheckpointService: mock().mockImplementation((checkpointManager: any) => ({
    create: async (input: { repoPath: string; includePaths?: string[]; message?: string }) => {
      const snapshot = await checkpointManager.createSafeSnapshot(
        input.repoPath,
        input.includePaths ?? [],
        input.message,
      );
      return { id: snapshot.commitHash };
    },
  })),
}));

mock.module('../../../src/core/strata/layers/worktree.js', () => ({
  WorkspaceManager: {
    setup: workspaceSetupMock,
    teardown: workspaceTeardownMock,
  },
}));

mock.module('../../../src/core/strata/layers/shadow-driver/shadow-driver.js', () => ({
  ShadowDriver: {
    hydrate: hydrateMock,
  },
}));

import { RuntimeEnvironment } from '../../../src/core/strata/runtime/environment.js';

function createOptions(overrides: Record<string, unknown> = {}): any {
  return {
    instruction: 'test',
    repoPath: '/repo',
    strategy: 'worktree',
    verify: undefined,
    ...overrides,
  };
}

describe('RuntimeEnvironment safety behavior', () => {
  beforeEach(() => {
    migrateLegacyRuntimeMock.mockClear();
    createSafeSnapshotMock.mockClear();
    restoreToShadowMock.mockClear();
    deleteSnapshotMock.mockClear();
    workspaceSetupMock.mockClear();
    workspaceTeardownMock.mockClear();
    hydrateMock.mockClear();
    gitQueryMock.mockClear();
    gitExecMetaMock.mockClear();

    createSafeSnapshotMock.mockResolvedValue({ commitHash: 'snapshot-hash' });
    workspaceSetupMock.mockResolvedValue({
      strategy: 'worktree',
      baseRepoPath: '/repo',
      workPath: '/tmp/s8p-wt/repo/test',
    });
    gitQueryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'rev-parse') return 'head-ref';
      return '';
    });
    gitExecMetaMock.mockResolvedValue({ ok: true });
  });

  it('throws when activeRepoPath is accessed before setup', () => {
    const env = new RuntimeEnvironment(createOptions(), mock());

    expect(() => env.activeRepoPath).toThrow();
  });

  it('fails setup when snapshot creation fails', async () => {
    createSafeSnapshotMock.mockRejectedValueOnce(new Error('snapshot-broken'));
    const env = new RuntimeEnvironment(createOptions(), mock());

    await expect(env.setup()).rejects.toMatchObject({
      code: 'PREFLIGHT_SNAPSHOT_FAILED',
      message: 'Failed to create snapshot: snapshot-broken',
      safeMeta: {
        strategy: 'worktree',
        worktreeEnabled: true,
        repoPathHash: expect.any(String),
        repoExists: expect.any(Boolean),
        gitAvailable: expect.anything(),
        includePathsCount: 0,
      },
    });
  });

  it('fails setup with preflight migration code when runtime migration throws', async () => {
    migrateLegacyRuntimeMock.mockRejectedValueOnce(new Error('migration-broken'));
    const env = new RuntimeEnvironment(createOptions(), mock());

    await expect(env.setup()).rejects.toMatchObject({
      code: 'PREFLIGHT_RUNTIME_MIGRATION_FAILED',
      message: 'Failed to migrate runtime state: migration-broken',
    });
  });

  it('captures git probe diagnostics when snapshot preflight probe throws', async () => {
    createSafeSnapshotMock.mockRejectedValueOnce(new Error('snapshot-broken'));
    gitExecMetaMock.mockRejectedValueOnce(
      Object.assign(new Error('probe-broken'), { code: 'ETIMEDOUT', name: 'ProbeError' }),
    );
    const env = new RuntimeEnvironment(createOptions(), mock());

    await expect(env.setup()).rejects.toMatchObject({
      code: 'PREFLIGHT_SNAPSHOT_FAILED',
      safeMeta: {
        gitAvailable: 'unknown',
        gitProbeErrorCode: 'ETIMEDOUT',
        gitProbeErrorName: 'ProbeError',
      },
    });
  });

  it('fails setup with preflight workspace code when workspace setup throws', async () => {
    workspaceSetupMock.mockRejectedValueOnce(new Error('workspace-broken'));
    const env = new RuntimeEnvironment(createOptions(), mock());

    await expect(env.setup()).rejects.toMatchObject({
      code: 'PREFLIGHT_WORKSPACE_INIT_FAILED',
      message: 'Failed to initialize workspace: workspace-broken',
    });
  });

  it('continues setup when dependency hydration fails and emits warning', async () => {
    hydrateMock.mockRejectedValueOnce(new Error('link-failed'));
    const events: any[] = [];
    const env = new RuntimeEnvironment(createOptions(), (event) => events.push(event));

    await expect(env.setup()).resolves.toBeUndefined();

    const warningEvent = events.find(
      (event) =>
        event?.type === 'log' &&
        event?.level === 'warn' &&
        typeof event?.message === 'string' &&
        event.message.includes('Dependency linking failed'),
    );
    expect(warningEvent).toBeTruthy();
  });

  it('teardown degrades safely when snapshot/worktree cleanup fails', async () => {
    deleteSnapshotMock.mockRejectedValueOnce(new Error('delete-failed'));
    workspaceTeardownMock
      .mockRejectedValueOnce(new Error('extra-cleanup-failed'))
      .mockRejectedValueOnce(new Error('workspace-cleanup-failed'));

    const events: any[] = [];
    const env = new RuntimeEnvironment(createOptions(), (event) => events.push(event));
    await env.setup();
    if (!env.workspace || env.workspace.strategy !== 'worktree') {
      throw new Error('Expected worktree workspace for teardown test');
    }
    env.workspace.workPath = '/tmp/s8p-wt/repo/current-changed';

    await expect(env.teardown()).resolves.toBeUndefined();

    const cleanedEvent = events.find((event) => event?.type === 'checkpoint.cleaned');
    expect(cleanedEvent?.ok).toBe(false);
    const warnCount = events.filter(
      (event) => event?.type === 'log' && event?.level === 'warn',
    ).length;
    expect(warnCount).toBeGreaterThan(0);
  });

  it('forces filesystem sync after restoreToShadow for worktree strategy', async () => {
    const env = new RuntimeEnvironment(createOptions({ strategy: 'worktree' }), mock());
    await env.setup();
    expect(gitQueryMock).toHaveBeenCalledWith(['status', '--short']);
  });
});
