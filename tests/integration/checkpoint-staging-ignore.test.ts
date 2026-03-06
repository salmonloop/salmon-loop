import { spawnSync } from 'child_process';
import { symlink } from 'fs/promises';
import { join } from 'path';

import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../src/core/strata/runtime/synchronizer.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

function runGit(repoPath: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: repoPath, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed with code ${result.status}: ${(result.stderr || '').trim()}`,
    );
  }
  return (result.stdout || '').trim();
}

describe('WorkspaceSynchronizer checkpoint staging', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('stages tracked changes even when path matches ignore rules', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/core/skills/bridge.ts', content: 'initial\n' }],
    });

    await helper.writeFile(repo.path, '.gitignore', 'skills/\n');
    await helper.createCommit(repo.path, 'add ignore rule', ['.gitignore']);

    await helper.modifyFile(repo.path, 'src/core/skills/bridge.ts', 'updated\n');
    await helper.writeFile(repo.path, 'src/core/skills/generated.tmp', 'ignored\n');

    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const checkpointHash = await synchronizer.createCheckpointCommit(repo.path, 'task-a', 'step-a');

    expect(checkpointHash).toMatch(/^[0-9a-f]{40}$/);

    const changedFiles = runGit(repo.path, ['show', '--name-only', '--pretty=format:', 'HEAD'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(changedFiles).toContain('src/core/skills/bridge.ts');
    expect(changedFiles).not.toContain('src/core/skills/generated.tmp');
  });

  it('skips hydrated dependency symlink paths during checkpoint staging', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'package.json', content: '{"name":"test-project","version":"1.0.0"}\n' },
        { path: 'src/index.ts', content: 'export const value = 1;\n' },
      ],
    });

    await helper.writeFile(repo.path, '.gitignore', 'node_modules/\n');
    await helper.createCommit(repo.path, 'add ignore rule', ['.gitignore']);

    const dependencyTarget = await helper.createTempDir('deps-target-');
    await helper.writeFile(dependencyTarget, 'placeholder.txt', 'dependency cache');
    await symlink(
      dependencyTarget,
      join(repo.path, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    const checkpointHash = await synchronizer.createCheckpointCommit(repo.path, 'task-a', 'step-a');

    expect(checkpointHash).toMatch(/^[0-9a-f]{40}$/);

    const changedFiles = runGit(repo.path, ['show', '--name-only', '--pretty=format:', 'HEAD'])
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    expect(changedFiles).toContain('src/index.ts');
    expect(changedFiles).not.toContain('node_modules');
  });
});
