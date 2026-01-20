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

  it('should call git apply with correct arguments', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();

    vi.mocked(spawn).mockReturnValue(mockChild);
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(unlink).mockResolvedValue(undefined);

    // Call applyPatch first to set up event listeners
    const promise = applyPatch(repoPath, 'fake diff');

    // Advance timers to allow process.nextTick to execute
    await vi.runAllTimersAsync();

    // Now emit the close event
    mockChild.emit('close', 0);

    await promise;

    expect(spawn).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['apply', '-3']),
      expect.objectContaining({ cwd: repoPath }),
    );
  });

  it('should rollback specific files', async () => {
    // Mock checkout child
    const checkoutChild = new EventEmitter() as any;
    checkoutChild.stdout = new EventEmitter();
    checkoutChild.stderr = new EventEmitter();

    // Mock status child
    const statusChild = new EventEmitter() as any;
    statusChild.stdout = new EventEmitter();
    statusChild.stderr = new EventEmitter();

    vi.mocked(spawn).mockReturnValueOnce(checkoutChild).mockReturnValueOnce(statusChild);

    const promise = rollbackFiles(repoPath, ['file1.ts', 'file2.ts']);

    // Advance timers and emit events in sequence
    await vi.runAllTimersAsync();
    checkoutChild.emit('close', 0);

    await vi.runAllTimersAsync();
    statusChild.stdout.emit('data', Buffer.from('')); // Empty = clean
    statusChild.emit('close', 0);

    const result = await promise;

    expect(result.ok).toBe(true);
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['checkout', '--', 'file1.ts', 'file2.ts'],
      expect.objectContaining({ cwd: repoPath }),
    );
  });

  it('should perform hard reset when forceReset is true', async () => {
    // Create mock children for the main spawn calls:
    const resetChild = new EventEmitter() as any;
    resetChild.stdout = new EventEmitter();
    resetChild.stderr = new EventEmitter();

    const cleanChild = new EventEmitter() as any;
    cleanChild.stdout = new EventEmitter();
    cleanChild.stderr = new EventEmitter();

    const statusChild = new EventEmitter() as any;
    statusChild.stdout = new EventEmitter();
    statusChild.stderr = new EventEmitter();

    vi.mocked(spawn)
      .mockReturnValueOnce(resetChild) // rollbackFiles reset --hard
      .mockReturnValueOnce(cleanChild) // rollbackFiles clean -fd
      .mockReturnValueOnce(statusChild); // rollbackFiles status check

    const promise = rollbackFiles(repoPath, [], true);

    // Emit events in sequence with timer advances
    await vi.runAllTimersAsync();
    resetChild.emit('close', 0);

    await vi.runAllTimersAsync();
    cleanChild.emit('close', 0);

    await vi.runAllTimersAsync();
    statusChild.stdout.emit('data', Buffer.from('')); // Empty = clean
    statusChild.emit('close', 0);

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
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();

    vi.mocked(spawn).mockReturnValue(mockChild);

    const promise = getGitDiff(repoPath);

    // Allow event listeners to be set up
    await vi.runAllTimersAsync();

    // Emit events
    mockChild.stdout.emit('data', Buffer.from('diff content'));
    mockChild.emit('close', 0);

    const diff = await promise;

    expect(diff).toBe('diff content');
    expect(spawn).toHaveBeenCalledWith('git', ['diff'], expect.objectContaining({ cwd: repoPath }));
  });

  it('should get git status', async () => {
    const mockChild = new EventEmitter() as any;
    mockChild.stdout = new EventEmitter();
    mockChild.stderr = new EventEmitter();

    vi.mocked(spawn).mockReturnValue(mockChild);

    const promise = getGitStatus(repoPath);

    // Allow event listeners to be set up
    await vi.runAllTimersAsync();

    // Emit events
    mockChild.stdout.emit('data', Buffer.from('M file1.ts'));
    mockChild.emit('close', 0);

    const status = await promise;

    expect(status).toBe('M file1.ts');
    expect(spawn).toHaveBeenCalledWith(
      'git',
      ['status', '--short'],
      expect.objectContaining({ cwd: repoPath }),
    );
  });
});
