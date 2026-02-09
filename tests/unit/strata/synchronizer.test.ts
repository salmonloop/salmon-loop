import { GitAdapter } from '../../../src/core/adapters/git/git-adapter.js';
import { CheckpointManager } from '../../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../../src/core/strata/runtime/synchronizer.js';

vi.mock('../../../src/core/adapters/git/git-adapter', () => {
  const mockQuery = vi.fn(async (args: string[]) => {
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

  const mockExecMeta = vi
    .fn()
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

  const mockExec = vi.fn().mockResolvedValue('');
  const mockCheckIgnore = vi.fn().mockResolvedValue(true);

  const MockGit = vi.fn().mockImplementation(() => ({
    query: mockQuery,
    execMeta: mockExecMeta,
    exec: mockExec,
    checkIgnore: mockCheckIgnore,
  }));

  return { GitAdapter: MockGit };
});

describe('WorkspaceSynchronizer checkpoint staging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
