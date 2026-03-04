import { describe, expect, it } from 'bun:test';

import { createSnapshotCommitFromStagedTree } from '../../../src/core/strata/checkpoint/snapshot-create.js';

describe('snapshot create helper', () => {
  it('builds a snapshot commit from staged tree and reports step progression', async () => {
    const execCalls: Array<{ args: string[]; env?: Record<string, string> }> = [];
    const steps: string[] = [];

    const git = {
      query: async (args: string[]) => {
        if (args[0] === 'ls-files') {
          return 'tracked-new.txt\nnode_modules/ignored.js\n';
        }
        return '';
      },
      exec: async (args: string[], options?: { env?: Record<string, string> }) => {
        execCalls.push({ args, env: options?.env });
        if (args[0] === 'write-tree') return 'working-tree-hash\n';
        if (args[0] === 'commit-tree') return 'commit-hash\n';
        if (args[0] === 'check-ignore') return 'ignored-file.txt\n';
        return '';
      },
    } as any;

    const commitHash = await createSnapshotCommitFromStagedTree({
      git,
      stagedTree: 'staged-tree-hash',
      includePaths: ['ignored-file.txt'],
      message: 'snapshot message',
      onStep: (step) => steps.push(step),
    });

    expect(commitHash).toBe('commit-hash');
    expect(steps).toEqual(['read-tree', 'add-u', 'write-tree-final', 'commit-tree']);

    expect(execCalls.some((call) => call.args.join(' ') === 'read-tree staged-tree-hash')).toBe(
      true,
    );
    expect(execCalls.some((call) => call.args.join(' ') === 'add -u .')).toBe(true);
    expect(execCalls.some((call) => call.args.join(' ') === 'add -- tracked-new.txt')).toBe(true);
    expect(execCalls.some((call) => call.args.join(' ') === 'add -f -- ignored-file.txt')).toBe(
      true,
    );
    expect(execCalls.some((call) => call.args[0] === 'write-tree')).toBe(true);
    expect(
      execCalls.some(
        (call) =>
          call.args[0] === 'commit-tree' &&
          call.args.join(' ').includes('"desc":"snapshot message"'),
      ),
    ).toBe(true);
  });

  it('ignores per-file include errors and still creates commit', async () => {
    const git = {
      query: async () => '',
      exec: async (args: string[]) => {
        if (args[0] === 'check-ignore') throw new Error('missing include path');
        if (args[0] === 'write-tree') return 'working-tree-hash\n';
        if (args[0] === 'commit-tree') return 'commit-hash\n';
        return '';
      },
    } as any;

    const commitHash = await createSnapshotCommitFromStagedTree({
      git,
      stagedTree: 'staged-tree-hash',
      includePaths: ['missing.txt'],
      message: 'snapshot message',
    });

    expect(commitHash).toBe('commit-hash');
  });
});
