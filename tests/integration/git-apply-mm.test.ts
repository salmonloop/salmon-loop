/**
 * GitApplyWorker Integration Test (MM)
 *
 * Regression guard:
 * - PATCH operations on MM files must not truncate files.
 * - git apply --3way must not fail with "does not match index" due to staged/unstaged divergence.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { GitApplyWorker } from '../../src/core/grizzco/workers/git-apply-worker.js';
import {
  FileStatus,
  OpType,
  type FileState,
  type ShadowOperation,
} from '../../src/core/shared/types/grizzco-types.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('GitApplyWorker (Real Filesystem) - MM', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('applies a patch to an MM file without touching the real index', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'test.txt', content: 'line1\nline2\n' }],
    });

    // Create staged change (index)
    await helper.modifyFile(repo.path, 'test.txt', 'line1\nstaged\nline2\n', true);
    // Create unstaged change (worktree)
    await helper.modifyFile(repo.path, 'test.txt', 'line1\nstaged\nunstaged\nline2\n', false);

    const worker = new GitApplyWorker(repo.path);

    const patch = [
      'diff --git a/test.txt b/test.txt',
      '--- a/test.txt',
      '+++ b/test.txt',
      '@@ -1,4 +1,5 @@',
      ' line1',
      '+// test',
      ' staged',
      ' unstaged',
      ' line2',
      '',
    ].join('\n');

    const op: ShadowOperation = {
      type: OpType.PATCH,
      path: 'test.txt',
      content: Buffer.from(patch, 'utf8'),
    };

    const state: FileState = {
      path: 'test.txt',
      status: FileStatus.MM,
      isBinary: false,
      isSymlink: false,
      isIgnored: false,
      size: 0,
    };

    const result = await worker.execute(op, state);
    expect(result.success).toBe(true);

    const content = await helper.readFile(repo.path, 'test.txt');
    expect(content).toContain('// test');
    expect(content).toContain('staged');
    expect(content).toContain('unstaged');

    // Index remains staged-only, working tree has unstaged + applied patch.
    const status = await helper.getGitStatus(repo.path);
    expect(status).toContain('MM test.txt');
  });
});
