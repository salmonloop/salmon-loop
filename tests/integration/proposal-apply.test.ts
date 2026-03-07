import { afterEach, describe, expect, it } from 'bun:test';

import { StubLLM } from '../../src/core/llm/openai.js';
import { RuntimeEnvironment } from '../../src/core/strata/runtime/environment.js';
import { ArtifactStore } from '../../src/core/sub-agent/artifacts/store.js';
import { executeProposalApply } from '../../src/core/tools/builtin/proposal.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('proposal.apply (integration)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('applies patch into shadow worktree without dirtying base workspace', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'foo.txt', content: 'old\n' }],
      createInitialCommit: true,
    });

    // Create a patch from base repo (old -> new), then restore the base workspace to clean.
    await helper.writeFile(repo.path, 'foo.txt', 'new\n');
    const diff = await helper.git(repo.path, ['diff'], { trim: false });
    expect(diff.exitCode).toBe(0);
    await helper.git(repo.path, ['checkout', '--', 'foo.txt']);

    const baseStatus = await helper.git(repo.path, ['status', '--porcelain']);
    expect(baseStatus.stdout).toBe('');

    const patchArtifact = await ArtifactStore.saveText({
      content: diff.stdout,
      mimeType: 'text/x-diff',
      fileExt: 'patch',
    });

    const env = new RuntimeEnvironment(
      {
        instruction: 'apply proposal patch',
        repoPath: repo.path,
        llm: new StubLLM(),
        strategy: 'worktree',
        verify: undefined,
      },
      () => {},
    );

    await env.setup();
    try {
      const worktreePath = env.workspace!.workPath;

      const result = await executeProposalApply(
        { handle: patchArtifact.handle, snapshotRef: env.initialSnapshotHash },
        {
          repoRoot: worktreePath,
          worktreeRoot: worktreePath,
          persistenceRoot: repo.path,
          attemptId: 1,
          dryRun: false,
        } as any,
      );

      expect(result.ok).toBe(true);

      const baseFile = await helper.readFile(repo.path, 'foo.txt');
      const baseFileStr = typeof baseFile === 'string' ? baseFile : baseFile.toString('utf-8');
      expect(baseFileStr.replace(/\r\n/g, '\n')).toBe('old\n');
      const shadowFile = await helper.readFile(worktreePath, 'foo.txt');
      const shadowFileStr =
        typeof shadowFile === 'string' ? shadowFile : shadowFile.toString('utf-8');
      expect(shadowFileStr.replace(/\r\n/g, '\n')).toBe('new\n');

      const baseStatusAfter = await helper.git(repo.path, ['status', '--porcelain']);
      expect(baseStatusAfter.stdout).toBe('');
    } finally {
      await env.teardown();
    }
  });
});
