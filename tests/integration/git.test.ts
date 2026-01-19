import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { writeFile, unlink } from 'fs/promises';

import { applyPatch, getGitDiff, getGitStatus, rollbackFiles } from '../../src/core/git.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('fs/promises', async () => {
  const actual = await vi.importActual('fs/promises');
  return {
    ...actual,
    writeFile: vi.fn(),
    unlink: vi.fn(),
  };
});

describe('Git Integration Tests', () => {
  const repoPath = '/fake-repo';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockSpawn(exitCode: number, stdout = '', stderr = '') {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    vi.mocked(spawn).mockReturnValue(child);

    setTimeout(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    }, 0);

    return child;
  }

  it('should call git apply with correct arguments', async () => {
    mockSpawn(0);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(unlink).mockResolvedValue(undefined);

    const promise = applyPatch(repoPath, 'fake diff');
    await vi.runAllTimersAsync();
    await promise;

    expect(spawn).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['apply', '-3']),
      expect.objectContaining({ cwd: repoPath }),
    );
  });

  it('should rollback specific files', async () => {
    mockSpawn(0);

    const promise = rollbackFiles(repoPath, ['file1.ts', 'file2.ts']);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '--', 'file1.ts', 'file2.ts'],
      expect.objectContaining({ cwd: repoPath }),
    );
  });

  it('should perform hard reset when forceReset is true', async () => {
    // First call for reset --hard
    const resetChild = new EventEmitter() as any;
    resetChild.stdout = new EventEmitter();
    resetChild.stderr = new EventEmitter();

    // Second call for clean -fd
    const cleanChild = new EventEmitter() as any;
    cleanChild.stdout = new EventEmitter();
    cleanChild.stderr = new EventEmitter();

    vi.mocked(spawn).mockReturnValueOnce(resetChild).mockReturnValueOnce(cleanChild);

    setTimeout(() => {
      resetChild.emit('close', 0);
      setTimeout(() => {
        cleanChild.emit('close', 0);
      }, 0);
    }, 0);

    const promise = rollbackFiles(repoPath, [], true);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'HEAD'],
      expect.objectContaining({ cwd: repoPath }),
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['clean', '-fd'],
      expect.objectContaining({ cwd: repoPath }),
    );
  });

  it('should get git diff', async () => {
    mockSpawn(0, 'diff content');

    const promise = getGitDiff(repoPath);
    await vi.runAllTimersAsync();
    const diff = await promise;

    expect(diff).toBe('diff content');
    expect(spawn).toHaveBeenCalledWith('git', ['diff'], expect.objectContaining({ cwd: repoPath }));
  });

  it('should get git status', async () => {
    mockSpawn(0, 'M file1.ts');

    const promise = getGitStatus(repoPath);
    await vi.runAllTimersAsync();
    const status = await promise;

    expect(status).toBe('M file1.ts');
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['status', '--short'],
      expect.objectContaining({ cwd: repoPath }),
    );
  });
});
