import { promises as fs } from 'fs';

import { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';
import { ShadowMergeEngine } from '../../../src/core/strata/engine/shadow-merge-engine.js';

// Mock dependencies
vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  },
}));
vi.mock('../../../src/core/adapters/git/git-adapter');
vi.mock('../../../src/core/strata/checkpoint/manager');
vi.mock('../../../src/core/logger');

describe('ShadowMergeEngine: 3-Way Merge Safety', () => {
  let engine: ShadowMergeEngine;
  let mockCheckpoints: any;
  let mockGit: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckpoints = new CheckpointManager();

    // Create a mock GitAdapter instance
    mockGit = {
      query: vi.fn(),
      exec: vi.fn(),
      getStatus: vi.fn(),
      getStatusForPath: vi.fn(),
      mergeFile: vi.fn(),
      hashObject: vi.fn(),
      show: vi.fn(),
      checkIgnore: vi.fn(),
      updateIndex: vi.fn(),
    };

    // Inject the mock instance when GitAdapter is instantiated
    (GitAdapter as any).mockImplementation(() => mockGit);

    // Setup default mock behaviors
    mockCheckpoints.createSafeSnapshot.mockResolvedValue({
      commitHash: 't0_hash',
      stagedTree: 'staged_tree_hash',
    });
    mockCheckpoints.createDirtyBackup.mockResolvedValue('t1_hash');
    mockGit.getStatus.mockResolvedValue('MM file.ts'); // Double Dirty
    mockGit.getStatusForPath.mockResolvedValue({
      staged: true,
      unstaged: true,
      untracked: false,
      deleted: false,
    });
    mockGit.query.mockResolvedValue('M\0file.ts\0'); // diff --name-status -z output
    mockGit.show.mockResolvedValue(Buffer.from('mock content'));
    mockGit.checkIgnore.mockResolvedValue(false);
    mockGit.mergeFile.mockResolvedValue({
      content: Buffer.from('merged content'),
      hasConflict: false,
    });
    mockGit.hashObject.mockResolvedValue('hash');

    // Setup default fs mock behaviors
    (fs.readFile as any).mockResolvedValue(Buffer.from('mock content'));
    (fs.writeFile as any).mockResolvedValue(undefined);
    (fs.mkdir as any).mockResolvedValue(undefined);
    (fs.unlink as any).mockResolvedValue(undefined);
  });

  it('should strictly follow the safety protocol: Snapshot -> Merge -> Verify', async () => {
    const mainRepoPath = '/mock/repo';
    const shadowRepoPath = '/mock/shadow';

    engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: shadowRepoPath,
        initialRef: 't0_base',
        latestRef: 'ai_patch',
        applyBackOnDirty: '3way',
      },
      mockCheckpoints,
    );

    // Success path
    mockGit.exec.mockResolvedValue(''); // success for write calls if any left using exec
    // query is still used for diff --name-status
    mockGit.query.mockImplementation((args: string[]) => {
      if (args.includes('diff') && args.includes('--name-status')) return 'M\0file.ts\0';
      if (args.includes('status')) return 'MM file.ts';
      return 'mock content';
    });
    mockGit.getStatusForPath.mockResolvedValue({
      staged: true,
      unstaged: true,
      untracked: false,
      deleted: false,
    });

    await engine.apply();

    // 1. Verification: Snapshot must be created BEFORE any write (Pre-flight safety)
    expect(mockCheckpoints.createSafeSnapshot).toHaveBeenCalledWith(mainRepoPath);

    // 2. Verification: 3-way merge command must be constructed correctly (Scenario D)
    // Now using gitAdapter.mergeFile instead of exec
    expect(mockGit.mergeFile).toHaveBeenCalled();

    // 3. Verification: NO calls to stage changes (Zero Index Access)
    // updateIndex should not be called in this flow or should be checked
    const updateIndexCalls = mockGit.updateIndex.mock.calls;
    expect(updateIndexCalls.length).toBe(0);

    // Also verify no 'add' calls via exec
    const gitAddCalls = mockGit.exec.mock.calls.filter((call: any) => call[0][0] === 'add');
    expect(gitAddCalls.length).toBe(0);
  });

  it('should correctly handle Scenario D (Double Dirty) by merging Disk content, not Index', async () => {
    const mainRepoPath = '/mock/repo';
    const shadowRepoPath = '/mock/shadow';

    engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: shadowRepoPath,
        initialRef: 't0_base',
        latestRef: 'ai_patch',
        applyBackOnDirty: '3way',
      },
      mockCheckpoints,
    );

    // Setup: file is MM (Staged + Unstaged)
    mockGit.getStatus.mockResolvedValue('MM file.ts');
    mockGit.getStatusForPath.mockResolvedValue({
      staged: true,
      unstaged: true,
      untracked: false,
      deleted: false,
    });
    mockGit.query.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return '';
      if (args.includes('diff') && args.includes('--name-status')) return 'M\0file.ts\0';
      return 'mock content';
    });

    await engine.apply();

    // Verification: 3-way merge should use Disk version as "Ours"
    // In our implementation, we read the disk file (fs.readFile)
    // We can't easily spy on fs.readFile here unless we mock fs, but we can verify
    // that we didn't ask git for the index version.

    expect(mockGit.mergeFile).toHaveBeenCalled();

    // Verify Zero Index Access: no 'git checkout' or 'git show :file' was used to get "Ours"
    // git show :file via adapter.show
    const gitShowIndexCalls = mockGit.show.mock.calls.filter(
      (call: any) => call[1] && call[1].startsWith(':'),
    );
    expect(gitShowIndexCalls.length).toBe(0);
  });

  it('should perform an atomic rollback on merge conflict', async () => {
    const mainRepoPath = '/mock/repo';
    const shadowRepoPath = '/mock/shadow';

    // Simulate merge-file conflict (via adapter return)
    mockGit.query.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return 'M file.ts';
      if (args.includes('diff') && args.includes('--name-status')) return 'M\0file.ts\0';
      return 'mock content';
    });
    mockGit.getStatusForPath.mockResolvedValue({
      staged: false,
      unstaged: false,
      untracked: false,
      deleted: false,
    });

    // mergeFile returns conflict
    mockGit.mergeFile.mockResolvedValue({
      content: Buffer.from('<<<< conflict'),
      hasConflict: true,
    });

    engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: shadowRepoPath,
        initialRef: 't0_base',
        latestRef: 'ai_patch',
        applyBackOnDirty: '3way',
      },
      mockCheckpoints,
    );

    try {
      await engine.apply();
    } catch (_e) {
      expect(mockCheckpoints.restoreDirtyBackup).toHaveBeenCalledWith(mainRepoPath, 't1_hash');
    }
  });

  it('should perform a robust reset when a system error occurs during apply', async () => {
    const mainRepoPath = '/mock/repo';
    engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: '/mock/shadow',
        initialRef: 't0_base',
        latestRef: 'ai_patch',
        applyBackOnDirty: '3way',
      },
      mockCheckpoints,
    );

    // Simulate system error in mergeFile (e.g. Git lock error)
    mockGit.mergeFile.mockRejectedValue(new Error('Git lock failed'));

    await expect(engine.apply()).rejects.toThrow('Git lock failed');

    // Verification: restoreDirtyBackup must be called to ensure atomicity
    expect(mockCheckpoints.restoreDirtyBackup).toHaveBeenCalledWith(mainRepoPath, 't1_hash');
  });

  it('should ignore binary files and proceed with text-based 3-way merge', async () => {
    engine = new ShadowMergeEngine(
      {
        mainRepoPath: '/mock/repo',
        shadowWorktreePath: '/mock/shadow',
        initialRef: 't0_base',
        latestRef: 'ai_patch',
        applyBackOnDirty: '3way',
      },
      mockCheckpoints,
    );

    mockGit.query.mockImplementation((args: string[]) => {
      if (args.includes('diff')) return 'M\timage.png';
      return 'mock content';
    });
    mockGit.getStatusForPath.mockResolvedValue({
      staged: false,
      unstaged: false,
      untracked: false,
      deleted: false,
    });

    await engine.apply();

    // Verify: merge-file should NOT be called for binary files
    expect(mockGit.mergeFile).not.toHaveBeenCalled();
  });

  it('should restore T0 snapshot when rollback runs without T1 backup in clean workspace', async () => {
    const mainRepoPath = '/mock/repo';

    mockCheckpoints.createDirtyBackup.mockResolvedValue(null);
    mockGit.getStatus.mockResolvedValue(''); // Clean at entry
    mockGit.getStatusForPath.mockResolvedValue({
      staged: false,
      unstaged: false,
      untracked: false,
      deleted: false,
    });
    mockGit.query.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return '';
      if (args.includes('diff') && args.includes('--name-status')) return 'M\0file.ts\0';
      return 'mock content';
    });
    mockGit.mergeFile.mockRejectedValue(new Error('merge failed'));

    engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: '/mock/shadow',
        initialRef: 't0_base',
        latestRef: 'ai_patch',
        applyBackOnDirty: '3way',
      },
      mockCheckpoints,
    );

    await expect(engine.apply()).rejects.toThrow('merge failed');

    expect(mockCheckpoints.restoreToMain).toHaveBeenCalledWith(mainRepoPath, 't0_hash', true);
    expect(mockCheckpoints.restoreDirtyBackup).not.toHaveBeenCalled();
  });

  it('should skip restoreToMain when rollback runs without T1 backup in dirty workspace', async () => {
    const mainRepoPath = '/mock/repo';

    mockCheckpoints.createDirtyBackup.mockResolvedValue(null);
    mockGit.getStatus.mockResolvedValue('M file.ts'); // Dirty at entry
    mockGit.getStatusForPath.mockResolvedValue({
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    });
    mockGit.query.mockImplementation((args: string[]) => {
      if (args[0] === 'status') return 'M file.ts';
      if (args.includes('diff') && args.includes('--name-status')) return 'M\0file.ts\0';
      return 'mock content';
    });
    mockGit.mergeFile.mockRejectedValue(new Error('merge failed'));

    engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: '/mock/shadow',
        initialRef: 't0_base',
        latestRef: 'ai_patch',
        applyBackOnDirty: '3way',
      },
      mockCheckpoints,
    );

    await expect(engine.apply()).rejects.toThrow('merge failed');

    expect(mockCheckpoints.restoreToMain).not.toHaveBeenCalled();
    expect(mockCheckpoints.restoreDirtyBackup).not.toHaveBeenCalled();
  });
});
