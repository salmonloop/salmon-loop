import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

import { createWorktreeCheckpoint, cleanupWorktreeCheckpoint } from '../../src/core/checkpoint/worktree.js';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock rimraf
vi.mock('rimraf', () => ({
  default: vi.fn((path, cb) => cb(null)),
}));

// Mock os to have stable tmpdir
vi.mock('os', () => ({
  tmpdir: () => '/tmp',
}));

describe('Worktree Checkpoint Integration (Mocked)', () => {
  const repoPath = '/fake/repo';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    vi.mocked(spawn).mockImplementation(() => {
      const child: any = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      child.killed = false;
      return child;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const getChild = (index: number) => {
    return vi.mocked(spawn).mock.results[index]?.value;
  };

  const waitForSpawn = async (n: number) => {
    await vi.waitUntil(() => vi.mocked(spawn).mock.calls.length >= n, {
        timeout: 1000, 
        interval: 5 
    });
  };

  it('should create worktree checkpoint successfully', async () => {
    const promise = createWorktreeCheckpoint(repoPath);

    // 1. is-inside-work-tree
    await waitForSpawn(1);
    const child1 = getChild(0);
    child1.stdout.emit('data', 'true\n');
    child1.emit('close', 0);

    // 2. HEAD
    await waitForSpawn(2);
    const child2 = getChild(1);
    child2.stdout.emit('data', 'abcdef123456\n');
    child2.emit('close', 0);

    // 3. worktree add
    await waitForSpawn(3);
    const child3 = getChild(2);
    child3.emit('close', 0);

    const result = await promise;

    expect(result).toBeDefined();
    expect(result.strategy).toBe('worktree');
    expect(result.worktreePath).toContain('salmon-loop-wt');
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it('should fail if not in a git repo', async () => {
    const promise = createWorktreeCheckpoint(repoPath);

    await waitForSpawn(1);
    const child1 = getChild(0);
    child1.stdout.emit('data', 'false\n');
    child1.emit('close', 0);

    await expect(promise).rejects.toThrow('Not a git repository');
  });

  it('should cleanup worktree checkpoint successfully via git', async () => {
    const checkpoint = {
        strategy: 'worktree' as const,
        repoPath,
        worktreePath: '/tmp/salmon-loop-wt/repo/123456',
        baseRef: 'abc',
        branchName: 'salmonloop/wt/123456'
      };
  
      const promise = cleanupWorktreeCheckpoint(checkpoint);
  
      // 1. git worktree list (new security check)
      await waitForSpawn(1);
      const child0 = getChild(0);
      child0.stdout.emit('data', `worktree /tmp/salmon-loop-wt/repo/123456\nHEAD abc123\nbranch refs/heads/salmonloop/wt/123456\n\n`);
      child0.emit('close', 0);
  
      // 2. worktree remove
      await waitForSpawn(2);
      getChild(1).emit('close', 0);
  
      // 3. branch delete
      await waitForSpawn(3);
      getChild(2).emit('close', 0);
  
      await promise;
  
      expect(spawn).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'remove']),
        expect.anything()
      );
  });

  it('should fallback to rimraf if git worktree remove fails', async () => {
    const checkpoint = {
        strategy: 'worktree' as const,
        repoPath,
        worktreePath: '/tmp/salmon-loop-wt/repo/123456',
        baseRef: 'abc',
        branchName: 'salmonloop/wt/123456'
      };
  
      const promise = cleanupWorktreeCheckpoint(checkpoint);
  
      // 1. git worktree list (new security check)
      await waitForSpawn(1);
      const child0 = getChild(0);
      child0.stdout.emit('data', `worktree /tmp/salmon-loop-wt/repo/123456\nHEAD abc123\nbranch refs/heads/salmonloop/wt/123456\n\n`);
      child0.emit('close', 0);
  
      // 2. worktree remove -> FAIL
      await waitForSpawn(2);
      getChild(1).emit('close', 1);
  
      // Fallback: rimraf (mocked to succeed)
  
      // 3. branch delete
      await waitForSpawn(3);
      getChild(2).emit('close', 0);
  
      await promise;
      
      // Success means fallback worked
  });

  it('should verify process timeout logic', async () => {
    const promise = createWorktreeCheckpoint(repoPath);

    await waitForSpawn(1);
    const child1 = getChild(0);
    // Do not resolve execution

    // Attach rejection handler BEFORE triggering timeout
    const expectPromise = expect(promise).rejects.toThrow('timed out');

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(30000);

    await expectPromise;
    expect(child1.kill).toHaveBeenCalled();
  });
});
