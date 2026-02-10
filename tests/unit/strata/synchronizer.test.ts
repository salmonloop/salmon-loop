import { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../../src/core/strata/runtime/synchronizer.js';

const { queryMock, execMetaMock, execMock, checkIgnoreMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  execMetaMock: vi.fn(),
  execMock: vi.fn(),
  checkIgnoreMock: vi.fn(),
}));

vi.mock('../../../src/core/adapters/git/git-adapter', () => {
  const MockGit = vi.fn().mockImplementation(() => ({
    query: queryMock,
    execMeta: execMetaMock,
    exec: execMock,
    checkIgnore: checkIgnoreMock,
  }));

  return { GitAdapter: MockGit };
});

describe('WorkspaceSynchronizer checkpoint staging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') {
        return ' M src/core/skills/bridge.ts\0';
      }
      if (args[0] === 'diff' && args.includes('--cached')) {
        return 'src/core/skills/bridge.ts';
      }
      if (args[0] === 'rev-parse') {
        return '0123456789abcdef0123456789abcdef01234567';
      }
      return '';
    });
    execMetaMock
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stderr: 'pathspec rejected by validation hook',
        stdout: Buffer.from(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        code: 0,
        stderr: '',
        stdout: Buffer.from(''),
      });
    execMock.mockResolvedValue('');
    checkIgnoreMock.mockResolvedValue(true);
  });

  it('falls back with check-ignore even when stderr does not indicate ignore', async () => {
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const result = await synchronizer.createCheckpointCommit('/mock/repo', 'task-a', 'step-a');

    expect(result).toBe('0123456789abcdef0123456789abcdef01234567');

    const GitAdapterMock = vi.mocked(GitAdapter);
    const gitInstance = GitAdapterMock.mock.results[0].value;

    expect(gitInstance.checkIgnore).toHaveBeenCalledWith('src/core/skills/bridge.ts');
    expect(gitInstance.execMeta).toHaveBeenNthCalledWith(1, [
      'add',
      '--',
      'src/core/skills/bridge.ts',
    ]);
    expect(gitInstance.execMeta).toHaveBeenNthCalledWith(2, [
      'add',
      '-u',
      '--',
      'src/core/skills/bridge.ts',
    ]);
  });

  it('parses porcelain -z status entries with spaces and rename paths', () => {
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());

    const entries = (synchronizer as any).parseStatusEntries(
      ' M dir/with space/file.txt\0R  old name.ts\0new name.ts\0 R old-second.ts\0new-second.ts\0?? untracked folder/new file.ts\0',
    );

    expect(entries).toEqual([
      { xy: ' M', path: 'dir/with space/file.txt' },
      { xy: 'R ', path: 'new name.ts', origPath: 'old name.ts' },
      { xy: ' R', path: 'new-second.ts', origPath: 'old-second.ts' },
      { xy: '??', path: 'untracked folder/new file.ts' },
    ]);
  });

  it('parses Y-side rename entries in getChangedPaths', async () => {
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') {
        return ' R old-name.ts\0new-name.ts\0?? note.txt\0';
      }
      return '';
    });

    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const changed = await synchronizer.getChangedPaths('/mock/repo');

    expect(changed).toEqual(['old-name.ts', 'new-name.ts', 'note.txt']);
  });

  it('supports zero retention override for dirty backup cleanup', () => {
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const original = process.env.SALMON_DIRTY_BACKUP_RETENTION_MS;
    process.env.SALMON_DIRTY_BACKUP_RETENTION_MS = '0';

    try {
      expect((synchronizer as any).getDirtyBackupRetentionMs()).toBe(0);
    } finally {
      if (original === undefined) {
        delete process.env.SALMON_DIRTY_BACKUP_RETENTION_MS;
      } else {
        process.env.SALMON_DIRTY_BACKUP_RETENTION_MS = original;
      }
    }
  });
});
