import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
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

  beforeEach(async () => {
    vi.clearAllMocks();

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
    if (repoPath) {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it('falls back to read-tree when staged patch restore fails', async () => {
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());

    vi.spyOn(synchronizer as any, 'analyzeStrategy').mockResolvedValue('AtomicPatch');
    vi.spyOn(synchronizer as any, 'applyAtomicPatch').mockRejectedValue(
      new Error('simulated apply failure'),
    );

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

    const usedPatchRestore = execMock.mock.calls.some(
      ([args]) => Array.isArray(args) && args[0] === 'apply' && args[1] === '--cached',
    );
    const usedReadTreeFallback = execMock.mock.calls.some(
      ([args]) => Array.isArray(args) && args[0] === 'read-tree' && args[1] === stagedTreeHash,
    );

    expect(usedPatchRestore).toBe(true);
    expect(usedReadTreeFallback).toBe(true);
    expect(telemetry.stagedRestoreAttempted).toBe(true);
    expect(telemetry.stagedRestoreSucceeded).toBe(true);
    expect(telemetry.stagedRestoreError).toBeUndefined();
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

    const checkpoints = new CheckpointManager();
    const restoreSpy = vi.spyOn(checkpoints, 'restoreToMain').mockResolvedValue();
    const synchronizer = new WorkspaceSynchronizer(checkpoints);

    vi.spyOn(synchronizer as any, 'analyzeStrategy').mockResolvedValue('AtomicPatch');
    vi.spyOn(synchronizer as any, 'applyAtomicPatch').mockRejectedValue(
      new Error('simulated clean apply failure'),
    );

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
        'initial-ref',
        'latest-ref',
        [],
        telemetry,
      ),
    ).rejects.toThrow('simulated clean apply failure');

    expect(restoreSpy).toHaveBeenCalledWith(repoPath, 'snapshot-hash-clean', true);
    expect(telemetry.rollbackPath).toBe('cleanSnapshot');

    const usedHardReset = execMock.mock.calls.some(
      ([args]) => Array.isArray(args) && args[0] === 'reset' && args[1] === '--hard',
    );
    expect(usedHardReset).toBe(false);
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

    const checkpoints = new CheckpointManager();
    const restoreSpy = vi
      .spyOn(checkpoints, 'restoreToMain')
      .mockRejectedValue(new Error('invalid snapshot metadata'));
    const synchronizer = new WorkspaceSynchronizer(checkpoints);

    vi.spyOn(synchronizer as any, 'analyzeStrategy').mockResolvedValue('AtomicPatch');
    vi.spyOn(synchronizer as any, 'applyAtomicPatch').mockRejectedValue(
      new Error('simulated clean apply failure'),
    );

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
        'initial-ref',
        'latest-ref',
        [],
        telemetry,
      ),
    ).rejects.toThrow('simulated clean apply failure');

    expect(restoreSpy).toHaveBeenCalledWith(repoPath, 'snapshot-hash-broken', true);
    expect(telemetry.rollbackPath).toBe('cleanReset');

    const usedHardReset = execMock.mock.calls.some(
      ([args]) => Array.isArray(args) && args[0] === 'reset' && args[1] === '--hard',
    );
    expect(usedHardReset).toBe(true);
  });
});
