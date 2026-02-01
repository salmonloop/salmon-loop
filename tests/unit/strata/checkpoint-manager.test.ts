import { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';

// Mock GitAdapter to verify low-level commands and environment isolation
vi.mock('../../../src/core/adapters/git/git-adapter', () => {
  const MockGit = vi.fn().mockImplementation(() => ({
    exec: vi.fn().mockResolvedValue('mock_hash_or_output'),
    query: vi.fn().mockResolvedValue('mock_tree_or_log'),
    getStatus: vi.fn().mockResolvedValue(''),
  }));
  return { GitAdapter: MockGit };
});

describe('CheckpointManager: Zero Index Access', () => {
  let manager: CheckpointManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new CheckpointManager();
  });

  it('should use a temporary index file during snapshot creation to avoid index pollution', async () => {
    const repoPath = '/mock/repo';
    await manager.createSafeSnapshot(repoPath);

    const GitAdapterMock = vi.mocked(GitAdapter);
    // Get the instance created inside createSafeSnapshot
    const gitInstance = GitAdapterMock.mock.results[0].value;

    // Core Verification: Must use GIT_INDEX_FILE environment variable
    const execCalls = gitInstance.exec.mock.calls;
    const hasTempIndex = execCalls.some((call: any) => {
      const options = call[1];
      return (
        options?.env &&
        options.env.GIT_INDEX_FILE &&
        options.env.GIT_INDEX_FILE.includes('s8p-idx-')
      );
    });

    expect(hasTempIndex).toBe(true);

    // Verify initialization of temp index from staged tree
    expect(gitInstance.exec).toHaveBeenCalledWith(
      expect.arrayContaining(['read-tree', 'mock_tree_or_log']),
      expect.objectContaining({ env: expect.any(Object) }),
    );
  });

  it('should capture staged state separately using the real index', async () => {
    const repoPath = '/mock/repo';
    await manager.createSafeSnapshot(repoPath);

    const GitAdapterMock = vi.mocked(GitAdapter);
    const gitInstance = GitAdapterMock.mock.results[0].value;

    // First write-tree should be the staged state (no temp env specified in query)
    expect(gitInstance.query).toHaveBeenCalledWith(['write-tree']);
  });

  it('should capture working tree state in the temporary environment', async () => {
    const repoPath = '/mock/repo';
    await manager.createSafeSnapshot(repoPath);

    const GitAdapterMock = vi.mocked(GitAdapter);
    const gitInstance = GitAdapterMock.mock.results[0].value;

    // Second write-tree should be for the working tree capture
    expect(gitInstance.exec).toHaveBeenCalledWith(
      ['write-tree'],
      expect.objectContaining({
        env: expect.objectContaining({ GIT_INDEX_FILE: expect.any(String) }),
      }),
    );
  });

  it('should persist the snapshot as a commit with metadata', async () => {
    const repoPath = '/mock/repo';
    await manager.createSafeSnapshot(repoPath, [], 'test snapshot');

    const GitAdapterMock = vi.mocked(GitAdapter);
    const gitInstance = GitAdapterMock.mock.results[0].value;

    // Verify commit-tree was called to create the snapshot object
    expect(gitInstance.exec).toHaveBeenCalledWith(
      expect.arrayContaining(['commit-tree', 'mock_hash_or_output', '-p', 'HEAD']),
      expect.anything(),
    );

    // Verify update-ref was called to persist the checkpoint
    expect(gitInstance.query).toHaveBeenCalledWith(
      expect.arrayContaining(['update-ref', '-m', 's8p-checkpoint']),
    );
  });
});
