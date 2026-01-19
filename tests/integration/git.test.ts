import { applyPatch, rollbackFiles, getGitDiff, getGitStatus } from '../../src/core/git.js';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import mockFs from 'mock-fs';
import { EventEmitter } from 'events';

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
    vi.clearAllMocks();
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
    }, 10);

    return child;
  }

  it('should call git apply with correct arguments', async () => {
    mockSpawn(0);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(unlink).mockResolvedValue(undefined);

    await applyPatch(repoPath, 'fake diff');

    expect(spawn).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['apply', '--3way']),
      expect.objectContaining({ cwd: repoPath })
    );
  });

  it('should rollback specific files', async () => {
    mockSpawn(0);

    const result = await rollbackFiles(repoPath, ['file1.ts', 'file2.ts']);

    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '--', 'file1.ts', 'file2.ts'],
      expect.objectContaining({ cwd: repoPath })
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

    vi.mocked(spawn)
      .mockReturnValueOnce(resetChild)
      .mockReturnValueOnce(cleanChild);

    setTimeout(() => {
      resetChild.emit('close', 0);
      setTimeout(() => {
        cleanChild.emit('close', 0);
      }, 5);
    }, 5);

    const result = await rollbackFiles(repoPath, [], true);

    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'HEAD'],
      expect.objectContaining({ cwd: repoPath })
    );
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['clean', '-fd'],
      expect.objectContaining({ cwd: repoPath })
    );
  });

  it('should get git diff', async () => {
    mockSpawn(0, 'diff content');

    const diff = await getGitDiff(repoPath);

    expect(diff).toBe('diff content');
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['diff'],
      expect.objectContaining({ cwd: repoPath })
    );
  });

  it('should get git status', async () => {
    mockSpawn(0, 'M file1.ts');

    const status = await getGitStatus(repoPath);

    expect(status).toBe('M file1.ts');
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['status', '--short'],
      expect.objectContaining({ cwd: repoPath })
    );
  });
});
