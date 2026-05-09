import { beforeEach, describe, expect, it, mock } from 'bun:test';

const statMock = mock();

mock.module('../../../src/core/adapters/fs/node-fs.js', () => ({
  stat: statMock,
}));

import {
  probeWriteTreeFailure,
  tryWriteTreeWithRetry,
} from '../../../src/core/strata/checkpoint/snapshot-write-tree.js';

describe('snapshot write-tree helpers', () => {
  beforeEach(() => {
    statMock.mockClear();
  });

  it('retries write-tree and eventually succeeds', async () => {
    let attempts = 0;
    const git = {
      query: async (args: string[]) => {
        if (args[0] !== 'write-tree') return '';
        attempts += 1;
        if (attempts < 3) throw new Error('transient write-tree failure');
        return 'tree-hash\n';
      },
    } as any;

    const result = await tryWriteTreeWithRetry(git, [0, 0]);
    expect(result).toEqual({ tree: 'tree-hash', attempts: 3 });
  });

  it('attaches writeTreeAttempts when retry budget is exhausted', async () => {
    const git = {
      query: async () => {
        throw Object.assign(new Error('fatal write-tree failure'), {
          code: 'GIT_ERROR',
        });
      },
    } as any;

    await expect(tryWriteTreeWithRetry(git, [0, 0])).rejects.toMatchObject({
      writeTreeAttempts: 3,
    });
  });

  it('probes lock/unmerged/worktree diagnostics safely', async () => {
    statMock.mockResolvedValue({ mtimeMs: Date.now() - 2000 } as any);
    const git = {
      repoPath: '/repo',
      exec: async (args: string[]) => {
        if (args[0] === 'ls-files') return '100644 deadbeef 1\tfile.txt\n';
        return '';
      },
      execMeta: async () => ({
        ok: false,
        code: 128,
        stderr: 'fatal: not a git repository',
      }),
    } as any;

    const details = await probeWriteTreeFailure(git);
    expect(details).toMatchObject({
      indexLockPresent: true,
      unmergedCount: 1,
      isInsideWorkTree: false,
      workTreeProbeErrorCode: 'EXIT_128',
      workTreeProbeHintCode: 'GIT_NOT_REPOSITORY',
    });
    expect(typeof details.indexLockAgeMs).toBe('number');
  });

  it('exposes spawnErrorCode when rev-parse fails at spawn layer', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('missing lock'), { code: 'ENOENT' }));
    const git = {
      repoPath: '/repo',
      exec: async (args: string[]) => {
        if (args[0] === 'ls-files') return '';
        return '';
      },
      execMeta: async () => ({
        ok: false,
        code: -1,
        stderr: 'spawn failed',
        error: { code: 'ENOENT', message: 'spawn git ENOENT' },
      }),
    } as any;

    const details = await probeWriteTreeFailure(git);
    expect(details).toMatchObject({
      isInsideWorkTree: false,
      spawnErrorCode: 'ENOENT',
      workTreeProbeErrorCode: 'ENOENT',
    });
  });

  it('returns safe defaults when probe sub-steps fail', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('missing lock'), { code: 'ENOENT' }));
    const git = {
      repoPath: '/repo',
      exec: async () => {
        throw new Error('ls-files unavailable');
      },
      execMeta: async () => {
        throw new Error('rev-parse unavailable');
      },
    } as any;

    const details = await probeWriteTreeFailure(git);
    expect(details).toMatchObject({
      indexLockPresent: false,
    });
    expect(details.unmergedCount).toBeUndefined();
    expect(details.isInsideWorkTree).toBeUndefined();
  });
});
