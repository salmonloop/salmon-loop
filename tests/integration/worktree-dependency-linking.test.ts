import { mkdtemp, readlink, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceManager } from '../../src/core/strata/layers/worktree.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('WorkspaceManager - Dependency Linking', () => {
  let testHelper: RealFsTestHelper;
  let testRepo: string;

  beforeEach(async () => {
    testHelper = new RealFsTestHelper();
    testRepo = await testHelper.createTempGitRepo();

    // Create a Node.js project with node_modules
    await testHelper.writeFile(join(testRepo, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0'
    }));
    await testHelper.mkdir(join(testRepo, 'node_modules'));
    await testHelper.writeFile(
      join(testRepo, 'node_modules', 'test-package.js'),
      'module.exports = "test";'
    );
  });

  afterEach(async () => {
    await testHelper.cleanup();
  });

  it('should symlink node_modules to worktree when strategy is worktree', async () => {
    // Arrange
    const workspace = await WorkspaceManager.setup(
      {
        instruction: 'test',
        verify: '',
        repoPath: testRepo,
        dryRun: false,
        strategy: 'worktree',
      },
      undefined,
      () => {},
    );

    try {
      // Assert - node_modules should be a symlink in worktree
      const worktreeNodeModules = join(workspace.workPath, 'node_modules');
      const linkTarget = await readlink(worktreeNodeModules);
      const expectedTarget = join(testRepo, 'node_modules');

      expect(linkTarget).toBe(expectedTarget);
    } finally {
      // Cleanup
      await WorkspaceManager.teardown(workspace);
    }
  });

  it('should not create symlinks when strategy is direct', async () => {
    // Arrange
    const workspace = await WorkspaceManager.setup(
      {
        instruction: 'test',
        verify: '',
        repoPath: testRepo,
        dryRun: false,
        strategy: 'direct',
      },
      undefined,
      () => {},
    );

    // Assert - workPath should be the same as repoPath
    expect(workspace.workPath).toBe(testRepo);
  });

  it('should handle missing node_modules gracefully', async () => {
    // Arrange - remove node_modules
    await rm(join(testRepo, 'node_modules'), { recursive: true });

    const workspace = await WorkspaceManager.setup(
      {
        instruction: 'test',
        verify: '',
        repoPath: testRepo,
        dryRun: false,
        strategy: 'worktree',
      },
      undefined,
      () => {},
    );

    try {
      // Assert - should not throw, worktree should still be created
      expect(workspace.strategy).toBe('worktree');
      expect(workspace.workPath).toContain('s8p-wt');
    } finally {
      await WorkspaceManager.teardown(workspace);
    }
  });
});
