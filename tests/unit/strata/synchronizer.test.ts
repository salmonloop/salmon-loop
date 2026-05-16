import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../../src/core/strata/runtime/synchronizer.js';

const { queryMock, execMetaMock, execMock, checkIgnoreMock } = (() => ({
  queryMock: mock(),
  execMetaMock: mock(),
  execMock: mock(),
  checkIgnoreMock: mock(),
}))();

const {
  copyFileMock,
  existsSyncMock,
  lstatMock,
  mkdirMock,
  readFileMock,
  readdirMock,
  realpathMock,
  rmMock,
  statMock,
  unlinkMock,
  writeFileMock,
} = (() => ({
  copyFileMock: mock(),
  existsSyncMock: mock(),
  lstatMock: mock(),
  mkdirMock: mock(),
  readFileMock: mock(),
  readdirMock: mock(),
  realpathMock: mock(),
  rmMock: mock(),
  statMock: mock(),
  unlinkMock: mock(),
  writeFileMock: mock(),
}))();

mock.module('../../../src/core/adapters/git/git-adapter', () => {
  const MockGit = mock().mockImplementation(() => ({
    query: queryMock,
    execMeta: execMetaMock,
    exec: execMock,
    checkIgnore: checkIgnoreMock,
  }));

  return { GitAdapter: MockGit };
});

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  copyFile: copyFileMock,
  existsSync: existsSyncMock,
  lstat: lstatMock,
  mkdir: mkdirMock,
  readFile: readFileMock,
  readdir: readdirMock,
  realpath: realpathMock,
  rm: rmMock,
  stat: statMock,
  unlink: unlinkMock,
  writeFile: writeFileMock,
}));

function enoent(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
}

function normalizeForAssert(value: string): string {
  return value.replace(/\\/g, '/');
}

describe('WorkspaceSynchronizer checkpoint staging', () => {
  beforeEach(() => {
    mock.restore();
    existsSyncMock.mockReturnValue(false);
    lstatMock.mockImplementation(async (targetPath: string) => {
      throw enoent(targetPath);
    });
    realpathMock.mockImplementation(async (targetPath: string) => {
      throw enoent(targetPath);
    });
    statMock.mockResolvedValue({ size: 16 });
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
  });

  it('collects changed paths from porcelain -z with spaces and renames', async () => {
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') {
        return (
          ' M dir/with space/file.txt\0' +
          'R  old name.ts\0new name.ts\0' +
          ' R old-second.ts\0new-second.ts\0' +
          '?? untracked folder/new file.ts\0'
        );
      }
      return '';
    });
    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const changed = await synchronizer.getChangedPaths('/mock/repo');

    expect(changed).toEqual([
      'dir/with space/file.txt',
      'old name.ts',
      'new name.ts',
      'old-second.ts',
      'new-second.ts',
      'untracked folder/new file.ts',
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

  it('filters symlinked dependency paths from getChangedPaths', async () => {
    lstatMock.mockImplementation(async (targetPath: string) => {
      if (normalizeForAssert(targetPath).endsWith('/mock/repo/node_modules')) {
        return { isSymbolicLink: () => true };
      }
      throw enoent(targetPath);
    });
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') {
        return '?? node_modules/pkg/index.js\0?? src/app.ts\0';
      }
      return '';
    });

    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const changed = await synchronizer.getChangedPaths('/mock/repo');

    expect(changed).toEqual(['src/app.ts']);
    expect(
      lstatMock.mock.calls.some(([targetPath]) =>
        normalizeForAssert(String(targetPath)).endsWith('/mock/repo/node_modules'),
      ),
    ).toBe(true);
  });

  it('returns null checkpoint when workspace has no changes', async () => {
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') return '';
      return '';
    });
    execMetaMock.mockReset();
    checkIgnoreMock.mockReset();

    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const result = await synchronizer.createCheckpointCommit('/mock/repo', 'task-b', 'step-b');

    expect(result).toBeNull();
  });

  it('returns null checkpoint when only ignored paths are changed', async () => {
    queryMock.mockImplementation(async (args: string[]) => {
      if (args[0] === 'status') return '?? build/generated.json\0';
      if (args[0] === 'diff' && args.includes('--cached')) return '';
      return '';
    });
    execMetaMock.mockReset();
    execMetaMock
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stderr: 'ignored by policy',
        stdout: Buffer.from(''),
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stderr: 'no tracked changes',
        stdout: Buffer.from(''),
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stderr: 'error: pathspec not found',
        stdout: Buffer.from(''),
      });
    checkIgnoreMock.mockResolvedValue(true);

    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const result = await synchronizer.createCheckpointCommit('/mock/repo', 'task-ignored', 'step');

    expect(result).toBeNull();
  });

  it('throws when staging fails for non-ignored path', async () => {
    execMetaMock.mockReset();
    execMetaMock.mockResolvedValue({
      ok: false,
      code: 128,
      stderr: 'fatal: pathspec error',
      stdout: Buffer.from(''),
    });
    checkIgnoreMock.mockResolvedValue(false);

    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());

    await expect(
      synchronizer.createCheckpointCommit('/mock/repo', 'task-c', 'step-c'),
    ).rejects.toThrow('Failed to stage path');
  });

  it('throws when ignored-path fallback fails for tracked file', async () => {
    execMetaMock.mockReset();
    execMetaMock
      .mockResolvedValueOnce({
        ok: false,
        code: 1,
        stderr: 'ignored by policy',
        stdout: Buffer.from(''),
      })
      .mockResolvedValueOnce({
        ok: false,
        code: 128,
        stderr: 'fatal: tracked fallback failed',
        stdout: Buffer.from(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        code: 0,
        stderr: '',
        stdout: Buffer.from('src/core/skills/bridge.ts\n'),
      });
    checkIgnoreMock.mockResolvedValue(true);

    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    await expect(
      synchronizer.createCheckpointCommit('/mock/repo', 'task-d', 'step-d'),
    ).rejects.toThrow('tracked fallback');
  });
});
