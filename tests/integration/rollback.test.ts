import { spawn } from 'child_process';
import { EventEmitter } from 'events';

import { rollbackFiles } from '../../src/core/git.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('Rollback Integration Tests', () => {
  const repoPath = '/fake-repo';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return ok: true and trigger resolveConflicts when git checkout fails with pathspec error', async () => {
    // First call fails with pathspec error
    const child1 = new EventEmitter() as any;
    child1.stdout = new EventEmitter();
    child1.stderr = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(child1);

    setTimeout(() => {
      child1.stderr.emit(
        'data',
        Buffer.from('error: pathspec file1.ts did not match any file(s) known to git'),
      );
      child1.emit('close', 1);
    }, 10);

    // Subsequent calls for resolveConflicts (stash, reset, clean, status)
    const childStash = new EventEmitter() as any;
    childStash.stdout = new EventEmitter();
    childStash.stderr = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(childStash);
    setTimeout(() => childStash.emit('close', 0), 20);

    const childReset = new EventEmitter() as any;
    childReset.stdout = new EventEmitter();
    childReset.stderr = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(childReset);
    setTimeout(() => childReset.emit('close', 0), 30);

    const childClean = new EventEmitter() as any;
    childClean.stdout = new EventEmitter();
    childClean.stderr = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(childClean);
    setTimeout(() => childClean.emit('close', 0), 40);

    // git status --porcelain to verify workspace is clean
    const childStatus = new EventEmitter() as any;
    childStatus.stdout = new EventEmitter();
    childStatus.stderr = new EventEmitter();
    vi.mocked(spawn).mockReturnValueOnce(childStatus);
    setTimeout(() => {
      childStatus.stdout.emit('data', Buffer.from('')); // Empty = clean
      childStatus.emit('close', 0);
    }, 50);

    const promise = rollbackFiles(repoPath, ['file1.ts']);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(result.stderr).toContain('Forced rollback via resolveConflicts');
    expect(spawn).toHaveBeenCalledWith('git', ['stash'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('git', ['reset', '--hard', 'HEAD'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('git', ['clean', '-fd'], expect.any(Object));
    expect(spawn).toHaveBeenCalledWith('git', ['status', '--porcelain'], expect.any(Object));
  });

  it('should handle spawn error during rollback', async () => {
    const child = new EventEmitter() as any;
    vi.mocked(spawn).mockReturnValue(child);

    setTimeout(() => {
      child.emit('error', new Error('spawn ENOENT'));
    }, 5);

    const promise = rollbackFiles(repoPath, ['file1.ts']);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('spawn ENOENT');
  });
});
