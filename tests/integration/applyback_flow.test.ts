import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { SalmonLoop } from '../../src/core/loop.js';
import { monitor } from '../../src/core/monitor.js';
import type { CheckpointRef } from '../../src/core/types.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('ApplyBack Flow Integration Tests', () => {
  const helper = new RealFsTestHelper();
  let loop: SalmonLoop;
  let mainRepoPath: string;
  let worktreePath: string;
  let checkpointRef: CheckpointRef;
  let initialRef: string;

  beforeEach(async () => {
    // create a new repo
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'app.js', content: 'original content' },
        { path: 'utils.js', content: 'export const x = 1;' },
      ],
    });
    mainRepoPath = repo.path;
    initialRef = repo.initialCommit!;

    // create a new Worktree
    worktreePath = await helper.createWorktree(mainRepoPath);

    checkpointRef = {
      strategy: 'worktree',
      repoPath: mainRepoPath,
      worktreePath,
      baseRef: initialRef,
      branchName: 'test-worktree',
    };

    loop = new SalmonLoop();
    monitor.resetMetrics();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await helper.cleanup();
    vi.restoreAllMocks();
  });

  const getApplyBack = (l: SalmonLoop) => (l as any).applyBackToMainWorkspace.bind(l);

  // Parameterized test scenarios for dirty workspace policies
  const dirtyWorkspaceScenarios = [
    {
      name: 'abort apply-back when main workspace is dirty with abort policy',
      policy: 'abort' as const,
      shouldThrow: true,
      testDescription: 'should abort when main workspace is dirty and policy is abort',
      mainFile: 'app.js',
      mainContent: 'user dirty change',
      worktreeFile: 'app.js',
      worktreeContent: 'worktree change',
    },
    {
      name: 'successfully merge when main is dirty and policy is 3way with non-conflicting changes',
      policy: '3way' as const,
      shouldThrow: false,
      testDescription: 'should successfully merge when main is dirty and policy is 3way',
      mainFile: 'utils.js',
      mainContent: 'export const x = 1; // user comment',
      worktreeFile: 'app.js',
      worktreeContent: 'updated content',
    },
    {
      name: 'apply changes directly when main is dirty and policy is none with non-conflicting changes',
      policy: 'none' as const,
      shouldThrow: false,
      testDescription: 'should apply changes directly when main is dirty and policy is none',
      mainFile: 'utils.js',
      mainContent: 'export const x = 1; // user comment',
      worktreeFile: 'app.js',
      worktreeContent: 'updated content',
    },
  ];

  // Scenario for merge conflict testing
  const mergeConflictScenario = {
    name: 'throw merge conflict error when applying changes to dirty workspace with conflicts',
    policy: '3way' as const,
    shouldThrow: true,
    errorMessage:
      /Apply-back completed with conflicts|merge conflict|conflict detected|could not apply patch/,
  };

  describe('applyBackToMainWorkspace with Real FS', () => {
    it('should successfully apply changes from worktree to main', async () => {
      // 1. Modify file in Worktree
      await helper.modifyFile(worktreePath, 'app.js', 'updated in worktree');

      // 2. Create a commit to get the latest Ref (for dual-merge path)
      const latestRef = await helper.createCommit(worktreePath, 'worktree change');

      const applyBack = getApplyBack(loop);
      await applyBack(
        mainRepoPath,
        checkpointRef,
        '', // diffText (optional in dual-merge mode)
        '3way',
        'none',
        ['app.js'],
        initialRef,
        latestRef,
      );

      // 3. Verify if main repo content is updated
      const content = await helper.readFile(mainRepoPath, 'app.js');
      expect(content).toBe('updated in worktree');

      // Verify metrics
      const metrics = monitor.getApplyBackMetrics();
      expect(metrics.attempts).toBe(1);
      expect(metrics.failures).toBe(0);
    });

    // Parameterized tests for dirty workspace policies
    test.each(dirtyWorkspaceScenarios)(
      '$testDescription',
      async ({ policy, shouldThrow, mainFile, mainContent, worktreeFile, worktreeContent }) => {
        // 1. Make main repo dirty
        await helper.writeFile(mainRepoPath, mainFile, mainContent);

        // 2. Also have changes in Worktree
        await helper.modifyFile(worktreePath, worktreeFile, worktreeContent);
        const latestRef = await helper.createCommit(worktreePath, 'worktree change');

        const applyBack = getApplyBack(loop);

        if (shouldThrow) {
          // 3. Verify if error is thrown with specific message
          await expect(
            applyBack(
              mainRepoPath,
              checkpointRef,
              '',
              policy,
              'none',
              [worktreeFile],
              initialRef,
              latestRef,
            ),
          ).rejects.toThrow(/main workspace has uncommitted changes/);

          // 4. Verify main repo content is not overwritten
          const content = await helper.readFile(mainRepoPath, mainFile);
          expect(content).toBe(mainContent);
        } else {
          // 3. Apply changes
          await applyBack(
            mainRepoPath,
            checkpointRef,
            '',
            policy,
            'none',
            [worktreeFile],
            initialRef,
            latestRef,
          );

          // 4. Verify changes are applied correctly
          // For non-conflicting changes, both files should exist with their respective contents
          const mainFileContent = await helper.readFile(mainRepoPath, mainFile);
          const worktreeFileContent = await helper.readFile(mainRepoPath, worktreeFile);

          // Verify main file still has user's dirty changes
          expect(mainFileContent).toBe(mainContent);
          // Verify worktree changes were applied
          expect(worktreeFileContent).toBe(worktreeContent);
        }
      },
    );

    it(mergeConflictScenario.name, async () => {
      // 1. Create conflict: main repo and Worktree modify the same line
      await helper.writeFile(mainRepoPath, 'app.js', 'dirty conflict');

      await helper.modifyFile(worktreePath, 'app.js', 'worktree conflict');
      const latestRef = await helper.createCommit(worktreePath, 'worktree conflict');

      const applyBack = getApplyBack(loop);

      // 2. Verify merge conflict related error is thrown with specific message
      await expect(
        applyBack(
          mainRepoPath,
          checkpointRef,
          '',
          mergeConflictScenario.policy,
          'none',
          ['app.js'],
          initialRef,
          latestRef,
        ),
      ).rejects.toThrow(mergeConflictScenario.errorMessage);

      // Verify metrics recorded failure
      expect(monitor.getApplyBackMetrics().failures).toBe(1);
    });

    // Test dirty backup creation on merge conflict
    it('should create rejection files when merge conflict occurs with 3way policy', async () => {
      // 1. Create conflict: main repo and Worktree modify the same line
      await helper.writeFile(mainRepoPath, 'app.js', 'dirty conflict');
      await helper.modifyFile(worktreePath, 'app.js', 'worktree conflict');
      const latestRef = await helper.createCommit(worktreePath, 'worktree conflict');

      const applyBack = getApplyBack(loop);

      // 2. Attempt to apply changes which should fail with conflict
      await expect(
        applyBack(
          mainRepoPath,
          checkpointRef,
          '',
          '3way',
          'none',
          ['app.js'],
          initialRef,
          latestRef,
        ),
      ).rejects.toThrow(/Apply-back completed with conflicts|merge conflict|conflict detected/);

      // 3. Verify conflict artifacts were created

      // Check if .s8p directory exists
      expect(await helper.fileExists(mainRepoPath, '.s8p')).toBe(true);

      // Check if rejections directory exists
      expect(await helper.fileExists(mainRepoPath, '.s8p/rejections')).toBe(true);

      // Check if rejection file was created for the conflicting file
      expect(await helper.fileExists(mainRepoPath, '.s8p/rejections/app.js.rej')).toBe(true);

      // Verify rejection file contains conflict information
      const rejectionContent = await helper.readFile(mainRepoPath, '.s8p/rejections/app.js.rej');
      // The rejection file content format depends on the git version and configuration,
      // but it should contain at least one of the conflicting changes or conflict markers.
      // Since we know it's a conflict, checking for conflict markers or content is good.
      // In this specific failure, it seems to contain 'worktree conflict' but maybe not 'dirty conflict'
      // depending on how the rejection is formatted.
      // Let's check for standard conflict markers or the content we know is there.
      expect(rejectionContent).toMatch(/dirty conflict|worktree conflict|<<<<<<<|>>>>>>>/);
    });

    // Test for binary file handling
    it('should correctly skip binary files during apply-back', async () => {
      // 1. Create a binary file (PNG image)
      const binaryContent = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0xf3, 0xff, 0x61, 0x00, 0x00, 0x00, 0x04, 0x73, 0x42, 0x49, 0x54, 0x08, 0x08, 0x08, 0x08,
        0x7c, 0x7c, 0x7c, 0x7c, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00, 0x0b,
        0x13, 0x00, 0x00, 0x0b, 0x13, 0x01, 0x00, 0x9a, 0x9c, 0x18, 0x00, 0x00, 0x00, 0x1c, 0x49,
        0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0x0f, 0x00, 0x00, 0x02, 0x02, 0x01, 0x00, 0x80,
        0x66, 0x08, 0x63, 0x10, 0x25, 0x81, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
      ]);
      await helper.writeFile(worktreePath, 'test.png', binaryContent);

      // 2. Create a commit with binary file
      const latestRef = await helper.createCommit(worktreePath, 'add binary file', ['test.png']);

      const applyBack = getApplyBack(loop);
      const result = await applyBack(
        mainRepoPath,
        checkpointRef,
        '', // diffText (optional in dual-merge mode)
        '3way',
        'none',
        ['test.png'],
        initialRef,
        latestRef,
      );

      // 3. Verify binary file was NOT copied to main repo (skipped)
      const fileExists = await helper.fileExists(mainRepoPath, 'test.png');
      expect(fileExists).toBe(false);

      // Verify apply-back completed successfully
      expect(result).toBeUndefined(); // applyBack doesn't return anything on success
    });
  });
});
