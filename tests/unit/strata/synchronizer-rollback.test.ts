import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../../src/core/strata/runtime/synchronizer.js';
import type { CheckpointRef } from '../../../src/core/types.js';

const { queryMock, execMock, execMetaMock, checkIgnoreMock, applyPatchMock, stagedTreeHash } =
  vi.hoisted(() => ({
    queryMock: vi.fn(),
    execMock: vi.fn(),
    execMetaMock: vi.fn(),
    checkIgnoreMock: vi.fn(),
    applyPatchMock: vi.fn(),
    stagedTreeHash: '1111111111111111111111111111111111111111',
  }));

vi.mock('../../../src/core/adapters/git/git-adapter', () => {
  return {
    GitAdapter: vi.fn().mockImplementation(() => ({
      query: queryMock,
      exec: execMock,
      execMeta: execMetaMock,
      checkIgnore: checkIgnoreMock,
      applyPatch: applyPatchMock,
    })),
  };
});

describe('WorkspaceSynchronizer rollback staged restore fallback', () => {
  let repoPath: string;
  let extraCleanupPaths: string[] = [];
  const originalRetention = process.env.SALMON_DIRTY_BACKUP_RETENTION_MS;

  const pathExists = async (targetPath: string): Promise<boolean> => {
    try {
      await stat(targetPath);
      return true;
    } catch {
      return false;
    }
  };

  const configureDirtyApplyFailure = () => {
    let workingDiffCalls = 0;
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status' && args.includes('--porcelain')) return 'M  staged.txt\n';
      if (args[0] === 'rev-parse') return 'ffffffffffffffffffffffffffffffffffffffff';
      if (args[0] === 'write-tree') return stagedTreeHash;
      if (args[0] === 'diff' && args.includes('--cached')) {
        return 'diff --git a/staged.txt b/staged.txt\n@@ -1 +1 @@\n-base\n+user staged content\n';
      }
      if (args[0] === 'diff' && args.includes('--name-status')) return 'A\0README.md\0';
      if (args[0] === 'diff' && args.includes('--name-only')) return 'README.md\0';
      if (args[0] === 'diff' && args.includes('--binary') && args.includes('--full-index')) {
        return 'diff --git a/README.md b/README.md\nindex e69de29..8b13789 100644\n--- a/README.md\n+++ b/README.md\n@@ -0,0 +1 @@\n+changed\n';
      }
      if (args[0] === 'diff') {
        const current = workingDiffCalls;
        workingDiffCalls += 1;
        return current === 0 ? '' : 'diff --git a/README.md b/README.md\n+changed\n';
      }
      if (args[0] === 'ls-files') return '';
      return '';
    });
    applyPatchMock.mockRejectedValue(new Error('simulated apply failure'));
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    extraCleanupPaths = [];

    repoPath = await mkdtemp(path.join(tmpdir(), 'salmon-sync-rollback-'));
    await mkdir(path.join(repoPath, '.git'), { recursive: true });
    await writeFile(path.join(repoPath, 'staged.txt'), 'user staged content\n');

    let workingDiffCalls = 0;
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status' && args.includes('--porcelain')) return 'M  staged.txt\n';
      if (args[0] === 'rev-parse') return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      if (args[0] === 'write-tree') return stagedTreeHash;
      if (args[0] === 'diff' && args.includes('--cached')) {
        return 'diff --git a/staged.txt b/staged.txt\n@@ -1 +1 @@\n-base\n+user staged content\n';
      }
      if (args[0] === 'diff') {
        const current = workingDiffCalls;
        workingDiffCalls += 1;
        return current === 0 ? '' : 'diff --git a/README.md b/README.md\n+changed\n';
      }
      if (args[0] === 'ls-files') return '';
      return '';
    });

    execMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'apply' && args[1] === '--cached') {
        throw new Error('simulated apply --cached failure');
      }
      return '';
    });
  });

  afterEach(async () => {
    if (originalRetention === undefined) {
      delete process.env.SALMON_DIRTY_BACKUP_RETENTION_MS;
    } else {
      process.env.SALMON_DIRTY_BACKUP_RETENTION_MS = originalRetention;
    }
    for (const cleanupPath of extraCleanupPaths) {
      await rm(cleanupPath, { recursive: true, force: true });
    }
    if (repoPath) {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it('falls back to read-tree when staged patch restore fails', async () => {
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    let workingDiffCalls = 0;
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status' && args.includes('--porcelain')) return 'M  staged.txt\n';
      if (args[0] === 'rev-parse') return 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      if (args[0] === 'write-tree') return stagedTreeHash;
      if (args[0] === 'diff' && args.includes('--cached')) {
        return 'diff --git a/staged.txt b/staged.txt\n@@ -1 +1 @@\n-base\n+user staged content\n';
      }
      if (args[0] === 'diff' && args.includes('--name-status')) return 'A\0README.md\0';
      if (args[0] === 'diff' && args.includes('--name-only')) return 'README.md\0';
      if (args[0] === 'diff' && args.includes('--binary') && args.includes('--full-index')) {
        return 'diff --git a/README.md b/README.md\nindex e69de29..8b13789 100644\n--- a/README.md\n+++ b/README.md\n@@ -0,0 +1 @@\n+changed\n';
      }
      if (args[0] === 'diff') {
        const current = workingDiffCalls;
        workingDiffCalls += 1;
        return current === 0 ? '' : 'diff --git a/README.md b/README.md\n+changed\n';
      }
      if (args[0] === 'ls-files') return '';
      return '';
    });
    applyPatchMock.mockRejectedValue(new Error('simulated apply failure'));

    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath,
      worktreePath: repoPath,
      baseRef: 'HEAD',
      branchName: 'test-rollback',
    };

    const telemetry: any = {};

    await expect(
      synchronizer.applyBackToMainWorkspace(
        repoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['staged.txt'],
        'initial-ref',
        'latest-ref',
        [],
        telemetry,
      ),
    ).rejects.toThrow('simulated apply failure');

    expect(telemetry.rollbackPath).toBe('dirtyBackup');
    expect(telemetry.stagedRestoreAttempted).toBe(true);
    expect(telemetry.stagedRestoreSucceeded).toBe(true);
    expect(telemetry.stagedRestoreError).toBeUndefined();
  });

  it('records staged-restore failure when patch and read-tree both fail', async () => {
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    let workingDiffCalls = 0;
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status' && args.includes('--porcelain')) return 'M  staged.txt\n';
      if (args[0] === 'rev-parse') return 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
      if (args[0] === 'write-tree') return stagedTreeHash;
      if (args[0] === 'diff' && args.includes('--cached')) {
        return 'diff --git a/staged.txt b/staged.txt\n@@ -1 +1 @@\n-base\n+user staged content\n';
      }
      if (args[0] === 'diff' && args.includes('--name-status')) return 'A\0README.md\0';
      if (args[0] === 'diff' && args.includes('--name-only')) return 'README.md\0';
      if (args[0] === 'diff' && args.includes('--binary') && args.includes('--full-index')) {
        return 'diff --git a/README.md b/README.md\nindex e69de29..8b13789 100644\n--- a/README.md\n+++ b/README.md\n@@ -0,0 +1 @@\n+changed\n';
      }
      if (args[0] === 'diff') {
        const current = workingDiffCalls;
        workingDiffCalls += 1;
        return current === 0 ? '' : 'diff --git a/README.md b/README.md\n+changed\n';
      }
      if (args[0] === 'ls-files') return '';
      return '';
    });
    execMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'apply' && args[1] === '--cached') {
        throw new Error('simulated apply --cached failure');
      }
      if (args[0] === 'read-tree') {
        throw new Error('simulated read-tree failure');
      }
      return '';
    });
    applyPatchMock.mockRejectedValue(new Error('simulated apply failure'));

    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath,
      worktreePath: repoPath,
      baseRef: 'HEAD',
      branchName: 'test-rollback-failure',
    };

    const telemetry: any = {};

    await expect(
      synchronizer.applyBackToMainWorkspace(
        repoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['staged.txt'],
        'initial-ref',
        'latest-ref',
        [],
        telemetry,
      ),
    ).rejects.toThrow('simulated apply failure');

    expect(telemetry.rollbackPath).toBe('dirtyBackup');
    expect(telemetry.stagedRestoreAttempted).toBe(true);
    expect(telemetry.stagedRestoreSucceeded).toBe(false);
    expect(telemetry.stagedRestoreError).toContain('simulated apply --cached failure');
    expect(telemetry.stagedRestoreError).toContain('simulated read-tree failure');
  });

  it('keeps expired backups when retention is disabled', async () => {
    process.env.SALMON_DIRTY_BACKUP_RETENTION_MS = '0';
    const expiredBackupDir = await mkdtemp(path.join(tmpdir(), 'salmon-loop-backup-expired-'));
    extraCleanupPaths.push(expiredBackupDir);
    const oldTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(expiredBackupDir, oldTime, oldTime);

    configureDirtyApplyFailure();
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath,
      worktreePath: repoPath,
      baseRef: 'HEAD',
      branchName: 'test-retention-disabled',
    };

    await expect(
      synchronizer.applyBackToMainWorkspace(
        repoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['staged.txt'],
        'initial-ref',
        'latest-ref',
        [],
        {},
      ),
    ).rejects.toThrow('simulated apply failure');

    expect(await pathExists(expiredBackupDir)).toBe(true);
  });

  it('prunes expired backups when retention is enabled', async () => {
    process.env.SALMON_DIRTY_BACKUP_RETENTION_MS = '1';
    const expiredBackupDir = await mkdtemp(path.join(tmpdir(), 'salmon-loop-backup-expired-'));
    extraCleanupPaths.push(expiredBackupDir);
    const oldTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await utimes(expiredBackupDir, oldTime, oldTime);

    configureDirtyApplyFailure();
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath,
      worktreePath: repoPath,
      baseRef: 'HEAD',
      branchName: 'test-retention-enabled',
    };

    await expect(
      synchronizer.applyBackToMainWorkspace(
        repoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['staged.txt'],
        'initial-ref',
        'latest-ref',
        [],
        {},
      ),
    ).rejects.toThrow('simulated apply failure');

    expect(await pathExists(expiredBackupDir)).toBe(false);
  });

  it('prefers explicit snapshot restore over hard reset when workspace was clean at entry', async () => {
    let workingDiffCalls = 0;
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status' && args.includes('--porcelain')) return '';
      if (args[0] === 'rev-parse') return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      if (args[0] === 'write-tree') return stagedTreeHash;
      if (args[0] === 'diff') {
        const current = workingDiffCalls;
        workingDiffCalls += 1;
        return current === 0 ? '' : 'diff --git a/README.md b/README.md\n+changed\n';
      }
      if (args[0] === 'ls-files') return '';
      return '';
    });
    execMock.mockResolvedValue('');

    const synchronizer = new WorkspaceSynchronizer({
      restoreToMain: vi.fn().mockResolvedValue(undefined),
    } as unknown as CheckpointManager);
    applyPatchMock.mockRejectedValue(new Error('simulated clean apply failure'));

    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath,
      worktreePath: repoPath,
      baseRef: 'snapshot-hash-clean',
      branchName: 'test-clean-rollback',
    };

    const telemetry: any = {};

    await expect(
      synchronizer.applyBackToMainWorkspace(
        repoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['README.md'],
        undefined,
        undefined,
        [],
        telemetry,
      ),
    ).rejects.toThrow('simulated clean apply failure');

    expect(telemetry.rollbackPath).toBe('cleanSnapshot');
  });

  it('falls back to hard reset when explicit snapshot restore fails', async () => {
    let workingDiffCalls = 0;
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status' && args.includes('--porcelain')) return '';
      if (args[0] === 'rev-parse') return 'cccccccccccccccccccccccccccccccccccccccc';
      if (args[0] === 'write-tree') return stagedTreeHash;
      if (args[0] === 'diff') {
        const current = workingDiffCalls;
        workingDiffCalls += 1;
        return current === 0 ? '' : 'diff --git a/README.md b/README.md\n+changed\n';
      }
      if (args[0] === 'ls-files') return '';
      return '';
    });
    execMock.mockResolvedValue('');

    const synchronizer = new WorkspaceSynchronizer({
      restoreToMain: vi.fn().mockRejectedValue(new Error('invalid snapshot metadata')),
    } as unknown as CheckpointManager);
    applyPatchMock.mockRejectedValue(new Error('simulated clean apply failure'));

    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath,
      worktreePath: repoPath,
      baseRef: 'snapshot-hash-broken',
      branchName: 'test-clean-fallback',
    };

    const telemetry: any = {};

    await expect(
      synchronizer.applyBackToMainWorkspace(
        repoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['README.md'],
        undefined,
        undefined,
        [],
        telemetry,
      ),
    ).rejects.toThrow('simulated clean apply failure');

    expect(telemetry.rollbackPath).toBe('cleanReset');
  });

  it('skips rollback when apply fails without workspace mutation', async () => {
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status' && args.includes('--porcelain')) return '';
      if (args[0] === 'rev-parse') return 'dddddddddddddddddddddddddddddddddddddddd';
      if (args[0] === 'write-tree') return stagedTreeHash;
      if (args[0] === 'diff') return '';
      if (args[0] === 'ls-files') return '';
      return '';
    });
    execMock.mockResolvedValue('');

    const synchronizer = new WorkspaceSynchronizer({
      restoreToMain: vi.fn().mockResolvedValue(undefined),
    } as unknown as CheckpointManager);
    applyPatchMock.mockRejectedValue(new Error('simulated no-change failure'));

    const checkpointRef: CheckpointRef = {
      strategy: 'worktree',
      repoPath,
      worktreePath: repoPath,
      baseRef: 'snapshot-hash-no-change',
      branchName: 'test-clean-no-change',
    };

    const telemetry: any = {};

    await expect(
      synchronizer.applyBackToMainWorkspace(
        repoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['README.md'],
        undefined,
        undefined,
        [],
        telemetry,
      ),
    ).rejects.toThrow('simulated no-change failure');

    expect(telemetry.workspaceChangedAfterFailure).toBe(false);
    expect(telemetry.rollbackPath).toBe('skipped-no-change');
  });
});
