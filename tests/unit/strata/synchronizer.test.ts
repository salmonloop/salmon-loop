import { mkdtemp, rm, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../../src/core/strata/runtime/synchronizer.js';

const { queryMock, execMetaMock, execMock, checkIgnoreMock } = (() => ({
  queryMock: vi.fn(),
  execMetaMock: vi.fn(),
  execMock: vi.fn(),
  checkIgnoreMock: vi.fn(),
}))();

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
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'salmon-sync-changes-'));
    const depTarget = await mkdtemp(path.join(tmpdir(), 'salmon-sync-dep-'));

    try {
      await symlink(
        depTarget,
        path.join(repoRoot, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      queryMock.mockImplementation(async (args: string[]) => {
        if (args[0] === 'status') {
          return '?? node_modules/pkg/index.js\0?? src/app.ts\0';
        }
        return '';
      });

      const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
      const changed = await synchronizer.getChangedPaths(repoRoot);

      expect(changed).toEqual(['src/app.ts']);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
      await rm(depTarget, { recursive: true, force: true });
    }
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
