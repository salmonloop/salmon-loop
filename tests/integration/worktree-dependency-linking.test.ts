import { readlink, rm } from 'fs/promises';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { ShadowDriver } from '../../src/core/strata/layers/shadow-driver/shadow-driver.js';
import { WorkspaceManager } from '../../src/core/strata/layers/worktree.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('WorkspaceManager - Dependency Linking', () => {
  let testHelper: RealFsTestHelper;
  let testRepo: string;

  beforeEach(async () => {
    testHelper = new RealFsTestHelper();
    const repo = await testHelper.createGitRepo();
    testRepo = repo.path;

    // Create a Node.js project with node_modules
    await testHelper.writeFile(
      testRepo,
      'package.json',
      JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
      }),
    );
    await testHelper.writeFile(
      testRepo,
      'node_modules/test-package.js',
      'module.exports = "test";',
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

    // Manually trigger dependency linking (simulating RuntimeEnvironment behavior)
    if (workspace.strategy === 'worktree') {
      await ShadowDriver.hydrate(testRepo, workspace.workPath);
    }

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

  it('should symlink multiple dependency dirs for multi-language projects', async () => {
    // Arrange - create Python and Rust projects
    await testHelper.writeFile(testRepo, 'requirements.txt', 'requests==2.31.0');
    // writeFile automatically creates directories
    await testHelper.writeFile(testRepo, 'venv/pyvenv.cfg', '[config]');

    await testHelper.writeFile(testRepo, 'Cargo.toml', '[package]\nname = "test"');
    await testHelper.writeFile(testRepo, 'target/debug.log', 'log');

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

    // Manually trigger dependency linking
    if (workspace.strategy === 'worktree') {
      await ShadowDriver.hydrate(testRepo, workspace.workPath);
    }

    try {
      // Assert - all detected deps should be linked
      const worktreeNodeModules = join(workspace.workPath, 'node_modules');
      const worktreeVenv = join(workspace.workPath, 'venv');
      const worktreeTarget = join(workspace.workPath, 'target');

      const nodeLink = await readlink(worktreeNodeModules);
      const venvLink = await readlink(worktreeVenv);
      const targetLink = await readlink(worktreeTarget);

      expect(nodeLink).toBe(join(testRepo, 'node_modules'));
      expect(venvLink).toBe(join(testRepo, 'venv'));
      expect(targetLink).toBe(join(testRepo, 'target'));
    } finally {
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
