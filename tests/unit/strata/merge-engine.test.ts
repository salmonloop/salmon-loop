import path from 'path';

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { clearLogger, setLogger } from '../../../src/core/observability/logger.js';
import type { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';
import { ShadowMergeEngine } from '../../../src/core/strata/engine/shadow-merge-engine.js';
import type { IFileSystemProvider } from '../../../src/core/strata/types.js';

const { adaptersByPath } = (() => ({
  adaptersByPath: new Map<string, any>(),
}))();

const { debugMock, infoMock, warnMock, errorMock, traceMock } = (() => ({
  debugMock: mock(),
  infoMock: mock(),
  warnMock: mock(),
  errorMock: mock(),
  traceMock: mock(),
}))();

mock.module('../../../src/core/adapters/git/git-adapter.js', () => ({
  GitAdapter: mock().mockImplementation((repoPath: string) => {
    if (!adaptersByPath.has(repoPath)) {
      adaptersByPath.set(repoPath, {
        query: mock(),
        exec: mock(),
        getStatusForPath: mock(),
        mergeFile: mock(),
        show: mock(),
        checkIgnore: mock().mockResolvedValue(false),
      });
    }
    return adaptersByPath.get(repoPath);
  }),
}));

function adapterFor(repoPath: string): any {
  const adapter = adaptersByPath.get(repoPath);
  if (!adapter) throw new Error(`Missing adapter for ${repoPath}`);
  return adapter;
}

type CheckpointManagerStub = Pick<
  CheckpointManager,
  'createSafeSnapshot' | 'createDirtyBackup' | 'restoreDirtyBackup' | 'restoreToMain'
>;

function asCheckpointManager(stub: CheckpointManagerStub): CheckpointManager {
  return stub as unknown as CheckpointManager;
}

class MemoryFsProvider implements IFileSystemProvider {
  private files = new Map<string, Buffer>();

  set(filePath: string, content: string | Buffer): void {
    this.files.set(
      filePath,
      Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, 'utf8'),
    );
  }

  getText(filePath: string): string | null {
    const value = this.files.get(filePath);
    return value ? value.toString('utf8') : null;
  }

  async readYours(repoPath: string, relativePath: string): Promise<Buffer | null> {
    return this.readFileBufferSafe(path.join(repoPath, relativePath));
  }

  async readFileBufferSafe(filePath: string): Promise<Buffer | null> {
    const value = this.files.get(filePath);
    return value ? Buffer.from(value) : null;
  }

  async writeFile(filePath: string, content: Buffer | string): Promise<void> {
    this.set(filePath, content);
  }

  async mkdir(): Promise<void> {}

  async unlink(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }

  async isBinary(): Promise<boolean> {
    return false;
  }
}

describe('ShadowMergeEngine behavior safety', () => {
  const mainRepoPath = '/mock/repo';
  const shadowRepoPath = '/mock/shadow';
  const targetPath = path.join(mainRepoPath, 'src/file.ts');

  afterAll(() => {
    mock.restore();
    clearLogger();
  });

  beforeEach(() => {
    setLogger({
      debug: debugMock,
      info: infoMock,
      warn: warnMock,
      error: errorMock,
      trace: traceMock,
    } as any);
    debugMock.mockReset();
    infoMock.mockReset();
    warnMock.mockReset();
    errorMock.mockReset();
    traceMock.mockReset();
    adaptersByPath.clear();
    mock.restore();
    new GitAdapter(mainRepoPath);
    new GitAdapter(shadowRepoPath);
  });

  function setupAdapters(options?: {
    statusLine?: string;
    diffNameStatus?: string;
    userStatus?: { staged: boolean; unstaged: boolean; untracked: boolean; deleted: boolean };
    mergeResult?: { content: Buffer; hasConflict: boolean };
    mergeError?: Error;
    baseContent?: Buffer;
    aiContent?: Buffer;
  }) {
    const mainAdapter = adapterFor(mainRepoPath);
    const shadowAdapter = adapterFor(shadowRepoPath);
    const statusLine = options?.statusLine ?? '';
    const diffNameStatus = options?.diffNameStatus ?? 'M\0src/file.ts\0';
    const userStatus = options?.userStatus ?? {
      staged: false,
      unstaged: true,
      untracked: false,
      deleted: false,
    };
    const baseContent = options?.baseContent ?? Buffer.from('base-line\n');
    const aiContent = options?.aiContent ?? Buffer.from('ai-line\n');

    mainAdapter.query.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status' && args[1] === '--porcelain') return statusLine;
      return '';
    });
    mainAdapter.getStatusForPath.mockResolvedValue(userStatus);
    if (options?.mergeError) {
      mainAdapter.mergeFile.mockRejectedValue(options.mergeError);
    } else {
      mainAdapter.mergeFile.mockResolvedValue(
        options?.mergeResult ?? { content: Buffer.from('merged-line\n'), hasConflict: false },
      );
    }

    shadowAdapter.query.mockImplementation(async (args: string[]) => {
      if (args[0] === 'diff' && args[1] === '--name-status') return diffNameStatus;
      return '';
    });
    shadowAdapter.show.mockImplementation(async (ref: string) => {
      if (ref === 'base-ref') return baseContent;
      if (ref === 'latest-ref') return aiContent;
      return Buffer.from('');
    });
  }

  it('applies merged file content to main workspace output', async () => {
    const fsProvider = new MemoryFsProvider();
    fsProvider.set(targetPath, 'user-line\n');
    setupAdapters({ statusLine: 'M src/file.ts' });

    const checkpoints = {
      createSafeSnapshot: mock().mockResolvedValue({
        commitHash: 'snapshot-t0',
        stagedTree: 'staged-tree',
      }),
      createDirtyBackup: mock().mockResolvedValue('backup-t1'),
      restoreDirtyBackup: mock(),
      restoreToMain: mock(),
    };

    const engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: shadowRepoPath,
        initialRef: 'base-ref',
        latestRef: 'latest-ref',
        applyBackOnDirty: '3way',
        fileSystemProvider: fsProvider,
      },
      asCheckpointManager(checkpoints),
    );

    await engine.apply();

    expect(fsProvider.getText(targetPath)).toBe('merged-line\n');
  });

  it('restores dirty-state content after conflict failure', async () => {
    const fsProvider = new MemoryFsProvider();
    fsProvider.set(targetPath, 'user-dirty-content\n');
    setupAdapters({
      statusLine: 'M src/file.ts',
      mergeResult: { content: Buffer.from('conflict-markers\n'), hasConflict: true },
    });

    const checkpoints = {
      createSafeSnapshot: mock().mockResolvedValue({
        commitHash: 'snapshot-t0',
        stagedTree: 'staged-tree',
      }),
      createDirtyBackup: mock().mockResolvedValue('backup-t1'),
      restoreDirtyBackup: mock().mockImplementation(async () => {
        fsProvider.set(targetPath, 'user-dirty-content\n');
      }),
      restoreToMain: mock(),
    };

    const engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: shadowRepoPath,
        initialRef: 'base-ref',
        latestRef: 'latest-ref',
        applyBackOnDirty: '3way',
        fileSystemProvider: fsProvider,
      },
      asCheckpointManager(checkpoints),
    );

    await expect(engine.apply()).rejects.toThrow('Apply-back completed with');
    expect(fsProvider.getText(targetPath)).toBe('user-dirty-content\n');
  });

  it('restores T0 snapshot state on clean-workspace failure when T1 is missing', async () => {
    const fsProvider = new MemoryFsProvider();
    fsProvider.set(targetPath, 'user-changed-content\n');
    setupAdapters({
      statusLine: '',
      mergeError: new Error('merge failed'),
    });

    const checkpoints = {
      createSafeSnapshot: mock().mockResolvedValue({
        commitHash: 'snapshot-t0',
        stagedTree: 'staged-tree',
      }),
      createDirtyBackup: mock().mockResolvedValue(null),
      restoreDirtyBackup: mock(),
      restoreToMain: mock().mockImplementation(async () => {
        fsProvider.set(targetPath, 'snapshot-t0-content\n');
      }),
    };

    const engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: shadowRepoPath,
        initialRef: 'base-ref',
        latestRef: 'latest-ref',
        applyBackOnDirty: '3way',
        fileSystemProvider: fsProvider,
      },
      asCheckpointManager(checkpoints),
    );

    await expect(engine.apply()).rejects.toThrow('merge failed');
    expect(fsProvider.getText(targetPath)).toBe('snapshot-t0-content\n');
  });

  it('keeps dirty workspace untouched when T1 backup is unavailable', async () => {
    const fsProvider = new MemoryFsProvider();
    fsProvider.set(targetPath, 'user-dirty-content\n');
    setupAdapters({
      statusLine: 'M src/file.ts',
      mergeError: new Error('merge failed'),
    });

    const checkpoints = {
      createSafeSnapshot: mock().mockResolvedValue({
        commitHash: 'snapshot-t0',
        stagedTree: 'staged-tree',
      }),
      createDirtyBackup: mock().mockResolvedValue(null),
      restoreDirtyBackup: mock(),
      restoreToMain: mock().mockImplementation(async () => {
        fsProvider.set(targetPath, 'unexpected-restore\n');
      }),
    };

    const engine = new ShadowMergeEngine(
      {
        mainRepoPath,
        shadowWorktreePath: shadowRepoPath,
        initialRef: 'base-ref',
        latestRef: 'latest-ref',
        applyBackOnDirty: '3way',
        fileSystemProvider: fsProvider,
      },
      asCheckpointManager(checkpoints),
    );

    await expect(engine.apply()).rejects.toThrow('merge failed');
    expect(fsProvider.getText(targetPath)).toBe('user-dirty-content\n');
  });
});
