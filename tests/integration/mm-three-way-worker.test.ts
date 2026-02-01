/**
 * MMThreeWayWorker Integration Test
 *
 * Regression guard: the MM worker must never treat raw file content as filesystem paths.
 * A failure in git merge-file must not silently produce empty output that could truncate files.
 */

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import { MMThreeWayWorker } from '../../src/core/grizzco/workers/mm-three-way-worker.js';
import {
  FileStatus,
  OpType,
  type FileState,
  type ShadowOperation,
} from '../../src/core/shared/types/grizzco-types.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('MMThreeWayWorker (Real Filesystem)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('merges base/ours/theirs without producing empty output', async () => {
    const baseText = 'line1\nline2\n';
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'test.txt', content: baseText }],
    });

    const adapter = new GitAdapter(repo.path);
    const worker = new MMThreeWayWorker(adapter);
    if (!repo.initialCommit) throw new Error('Expected initial commit hash');

    const theirsText = 'line1\n// test\nline2\n';
    const op: ShadowOperation = {
      type: OpType.OVERWRITE,
      path: 'test.txt',
      content: Buffer.from(theirsText, 'utf8'),
    };

    const state: FileState = {
      path: 'test.txt',
      status: FileStatus.MM,
      isBinary: false,
      isSymlink: false,
      isIgnored: false,
      size: baseText.length,
    };

    const result = await worker.execute(op, state, { snapshotId: repo.initialCommit });

    expect(result.success).toBe(true);
    expect(result.mergedContent?.length).toBeGreaterThan(0);
    expect(result.mergedContent?.toString('utf8')).toBe(theirsText);
  });
});
