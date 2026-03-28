import { readlink, rm } from 'fs/promises';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { clearLogger, createLogger, setLogger } from '../../src/core/observability/logger.js';
import { ShadowDriver } from '../../src/core/strata/layers/shadow-driver/shadow-driver.js';
import { WorkspaceManager } from '../../src/core/strata/layers/worktree.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('WorkspaceManager - Dependency Linking', () => {
  let testHelper: RealFsTestHelper;
  let testRepo: string;

  beforeEach(
    async () => {
      setLogger(createLogger({ silent: true }));
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
    },
    { timeout: 15000 },
  );

  afterEach(
    async () => {
      clearLogger();
      await testHelper.cleanup();
    },
    { timeout: 15000 },
  );

  it(
    'should symlink node_modules to worktree when strategy is worktree',
    async () => {
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
    },
    { timeout: 15000 },
  );

  it(
    'should preserve source dependency contents when tearing down a worktree with linked node_modules',
    async () => {
      if (process.platform !== 'win32') {
        return;
      }

      await testHelper.writeFile(
        testRepo,
        'node_modules/.bin/sentinel.cmd',
        '@echo off\necho sentinel\n',
      );
      const tempDir = await testHelper.createTempDir('worktree-prepare-');
      const harnessSource = join(tempDir, 'cases.test.js');
      const prepareScript = join(tempDir, 'prepare-worktree.ps1');
      await testHelper.writeFile(tempDir, 'cases.test.js', 'export {};\n');
      await testHelper.writeFile(
        tempDir,
        'prepare-worktree.ps1',
        [
          'param(',
          '  [Parameter(Mandatory = $true)]',
          '  [string]$HarnessSource,',
          '  [Parameter(Mandatory = $true)]',
          '  [string]$NodeModulesSource',
          ')',
          '',
          '$worktreeRoot = (Get-Location).Path',
          "$testDir = Join-Path $worktreeRoot '__tests__\\salmonloop-eval'",
          "$testFile = Join-Path $testDir 'cases.test.js'",
          "$nodeModulesTarget = Join-Path $worktreeRoot 'node_modules'",
          '',
          'New-Item -ItemType Directory -Path $testDir -Force | Out-Null',
          'Copy-Item -LiteralPath $HarnessSource -Destination $testFile -Force',
          '',
          'if (-not (Test-Path -LiteralPath $nodeModulesTarget)) {',
          '  New-Item -ItemType Junction -Path $nodeModulesTarget -Target $NodeModulesSource | Out-Null',
          '}',
          '',
        ].join('\n'),
      );

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

      const prepareResult = await testHelper.exec(workspace.workPath, 'powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        prepareScript,
        '-HarnessSource',
        harnessSource,
        '-NodeModulesSource',
        join(testRepo, 'node_modules'),
      ]);
      expect(prepareResult.exitCode).toBe(0);

      await WorkspaceManager.teardown(workspace);

      expect(await testHelper.fileExists(testRepo, 'node_modules/.bin/sentinel.cmd')).toBe(true);
      expect(await testHelper.readFile(testRepo, 'node_modules/.bin/sentinel.cmd')).toContain(
        'sentinel',
      );
      expect(await testHelper.readFile(testRepo, 'node_modules/test-package.js')).toContain('test');
    },
    { timeout: 15000 },
  );

  it(
    'should symlink multiple dependency dirs for multi-language projects',
    async () => {
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
    },
    { timeout: 15000 },
  );

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

  it(
    'should handle missing node_modules gracefully',
    async () => {
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
    },
    { timeout: 15000 },
  );
});
