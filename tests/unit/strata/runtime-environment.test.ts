const {
  migrateLegacyRuntimeMock,
  createSafeSnapshotMock,
  restoreToShadowMock,
  deleteSnapshotMock,
  workspaceSetupMock,
  workspaceTeardownMock,
  hydrateMock,
  gitQueryMock,
} = vi.hoisted(() => ({
  migrateLegacyRuntimeMock: vi.fn().mockResolvedValue(undefined),
  createSafeSnapshotMock: vi.fn(),
  restoreToShadowMock: vi.fn().mockResolvedValue(undefined),
  deleteSnapshotMock: vi.fn().mockResolvedValue(undefined),
  workspaceSetupMock: vi.fn(),
  workspaceTeardownMock: vi.fn().mockResolvedValue(undefined),
  hydrateMock: vi.fn().mockResolvedValue(undefined),
  gitQueryMock: vi.fn(),
}));

vi.mock('../../../src/core/runtime-paths.js', () => ({
  migrateLegacyRuntime: migrateLegacyRuntimeMock,
}));

vi.mock('../../../src/core/llm/errors.js', () => ({
  sanitizeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: vi.fn().mockImplementation(() => ({
    query: gitQueryMock,
  })),
}));

vi.mock('../../../src/core/strata/checkpoint/manager.js', () => ({
  CheckpointManager: vi.fn().mockImplementation(() => ({
    createSafeSnapshot: createSafeSnapshotMock,
    restoreToShadow: restoreToShadowMock,
    deleteSnapshot: deleteSnapshotMock,
  })),
}));

vi.mock('../../../src/core/strata/layers/worktree.js', () => ({
  WorkspaceManager: {
    setup: workspaceSetupMock,
    teardown: workspaceTeardownMock,
  },
}));

vi.mock('../../../src/core/strata/layers/shadow-driver/shadow-driver.js', () => ({
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
    vi.clearAllMocks();
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
  });

  it('throws when activeRepoPath is accessed before setup', () => {
    const env = new RuntimeEnvironment(createOptions(), vi.fn());

    expect(() => env.activeRepoPath).toThrow();
  });

  it('fails setup when snapshot creation fails', async () => {
    createSafeSnapshotMock.mockRejectedValueOnce(new Error('snapshot-broken'));
    const env = new RuntimeEnvironment(createOptions(), vi.fn());

    await expect(env.setup()).rejects.toThrow('Failed to create snapshot: snapshot-broken');
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
});
