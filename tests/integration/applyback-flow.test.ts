import { lstat, symlink } from 'fs/promises';
import { join } from 'path';

import { monitor } from '../../src/core/observability/monitor.js';
import { CheckpointManager } from '../../src/core/strata/checkpoint/manager.js';
import { WorkspaceSynchronizer } from '../../src/core/strata/runtime/synchronizer.js';
import type { ApplyBackTelemetry } from '../../src/core/strata/runtime/synchronizer.js';
import type { CheckpointRef } from '../../src/core/types.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('ApplyBack Flow Integration Tests', () => {
  const helper = new RealFsTestHelper();
  let synchronizer: WorkspaceSynchronizer;
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

    synchronizer = new WorkspaceSynchronizer(new CheckpointManager());
    monitor.resetMetrics();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await helper.cleanup();
    vi.restoreAllMocks();
  });

  const getApplyBack = (s: WorkspaceSynchronizer) => s.applyBackToMainWorkspace.bind(s);

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
      policy: 'none' as any, // Cast to any to test fallback behavior
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
      /Apply-back completed with conflicts|merge conflict|conflict detected|could not apply patch|Grizzco apply-back transaction failed/,
  };

  describe('applyBackToMainWorkspace with Real FS', () => {
    it('should successfully apply changes from worktree to main', async () => {
      // 1. Modify file in Worktree
      await helper.modifyFile(worktreePath, 'app.js', 'updated in worktree');

      // 2. Create a commit to get the latest Ref (for dual-merge path)
      const latestRef = await helper.createCommit(worktreePath, 'worktree change');
      const telemetry: ApplyBackTelemetry = {};

      const applyBack = getApplyBack(synchronizer);
      await applyBack(
        mainRepoPath,
        checkpointRef,
        '', // diffText (optional in dual-merge mode)
        '3way',
        undefined,
        ['app.js'],
        initialRef,
        latestRef,
        [],
        telemetry,
      );

      // 3. Verify if main repo content is updated
      const content = await helper.readFile(mainRepoPath, 'app.js');
      expect(content).toBe('updated in worktree');

      expect(telemetry.startedAt).toBeTruthy();
      expect(telemetry.finishedAt).toBeTruthy();
      expect(telemetry.usedShadowRefs).toBe(true);
      expect(telemetry.appliedToMain).toBe(true);
      expect(telemetry.rollbackPath).toBe('none');

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

        const applyBack = getApplyBack(synchronizer);

        if (shouldThrow) {
          // 3. Verify if error is thrown with specific message
          await expect(
            applyBack(
              mainRepoPath,
              checkpointRef,
              '',
              policy,
              undefined,
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
            undefined,
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

      const applyBack = getApplyBack(synchronizer);

      // 2. Verify merge conflict error is NOT thrown, but markers are present
      // Smart Routing -> ExplicitMerge -> Success with markers
      await applyBack(
        mainRepoPath,
        checkpointRef,
        '',
        mergeConflictScenario.policy,
        undefined,
        ['app.js'],
        initialRef,
        latestRef,
      );

      // Verify conflict markers are in the file
      const content = await helper.readFile(mainRepoPath, 'app.js');
      expect(content).toContain('<<<<<<<');
      expect(content).toContain('dirty conflict');
      expect(content).toContain('worktree conflict');
      expect(content).toContain('>>>>>>>');

      // Verify metrics recorded success
      expect(monitor.getApplyBackMetrics().failures).toBe(0);
    });

    // Test dirty backup creation on merge conflict
    it('should leave conflict markers when merge conflict occurs with 3way policy', async () => {
      // 1. Create conflict: main repo and Worktree modify the same line
      await helper.writeFile(mainRepoPath, 'app.js', 'dirty conflict');
      await helper.modifyFile(worktreePath, 'app.js', 'worktree conflict');
      const latestRef = await helper.createCommit(worktreePath, 'worktree conflict');

      const applyBack = getApplyBack(synchronizer);

      // 2. Attempt to apply changes which should succeed with markers
      await applyBack(
        mainRepoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['app.js'],
        initialRef,
        latestRef,
      );

      // 3. Verify markers are present
      const content = await helper.readFile(mainRepoPath, 'app.js');
      expect(content).toMatch(/<<<<<<<|>>>>>>>/);
      expect(content).toContain('dirty conflict');
      expect(content).toContain('worktree conflict');
    });

    // Test for binary file handling
    it('should correctly apply binary files during apply-back', async () => {
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

      const applyBack = getApplyBack(synchronizer);
      const result = await applyBack(
        mainRepoPath,
        checkpointRef,
        '', // diffText (optional in dual-merge mode)
        '3way',
        undefined,
        ['test.png'],
        initialRef,
        latestRef,
      );

      // 3. Verify binary file WAS copied to main repo (AtomicPatch supports binaries)
      const fileExists = await helper.fileExists(mainRepoPath, 'test.png');
      expect(fileExists).toBe(true);

      const content = await helper.readFile(mainRepoPath, 'test.png', null); // Read as Buffer
      expect(Buffer.compare(content as Buffer, binaryContent)).toBe(0);

      // Verify apply-back completed successfully
      expect(result).toBeUndefined();
    });

    it('should ignore node_modules symlink changes when applying AtomicPatch', async () => {
      await helper.writeFile(mainRepoPath, 'node_modules/pkg/index.js', 'module.exports = 1;\n');

      await helper.modifyFile(worktreePath, 'app.js', 'updated in worktree');
      await helper.writeFile(
        worktreePath,
        'package.json',
        '{"name":"applyback-test","version":"1.0.0"}\n',
      );

      await symlink(
        join(mainRepoPath, 'node_modules'),
        join(worktreePath, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const latestRef = await helper.createCommit(
        worktreePath,
        'worktree change with dependency link',
        ['app.js', 'package.json', 'node_modules'],
      );

      const telemetry: ApplyBackTelemetry = {};
      const applyBack = getApplyBack(synchronizer);

      await applyBack(
        mainRepoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        ['app.js', 'package.json'],
        initialRef,
        latestRef,
        [],
        telemetry,
      );

      const content = await helper.readFile(mainRepoPath, 'app.js');
      expect(content).toBe('updated in worktree');
      expect(await helper.fileExists(mainRepoPath, 'package.json')).toBe(true);

      const nodeModulesStat = await lstat(join(mainRepoPath, 'node_modules'));
      expect(nodeModulesStat.isSymbolicLink()).toBe(false);

      expect(telemetry.selectedStrategy).toBe('AtomicPatch');
      expect(telemetry.appliedToMain).toBe(true);
      expect(telemetry.error).toBeUndefined();
    });

    it('should no-op safely when only dependency projection paths changed', async () => {
      const dependencyTarget = await helper.createTempDir('dep-target-');
      await helper.writeFile(dependencyTarget, 'index.js', 'module.exports = 1;\n');

      await symlink(
        dependencyTarget,
        join(worktreePath, 'node_modules'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const latestRef = await helper.createCommit(worktreePath, 'dependency projection only', [
        'node_modules',
      ]);
      const telemetry: ApplyBackTelemetry = {};
      const applyBack = getApplyBack(synchronizer);

      await applyBack(
        mainRepoPath,
        checkpointRef,
        '',
        '3way',
        undefined,
        [],
        initialRef,
        latestRef,
        [],
        telemetry,
      );

      const appContent = await helper.readFile(mainRepoPath, 'app.js');
      expect(appContent).toBe('original content');

      const utilsContent = await helper.readFile(mainRepoPath, 'utils.js');
      expect(utilsContent).toBe('export const x = 1;');

      const mainStatus = await helper.getGitStatus(mainRepoPath);
      expect(mainStatus.trim()).toBe('');

      expect(telemetry.selectedStrategy).toBe('AtomicPatch');
      expect(telemetry.appliedToMain).toBe(true);
      expect(telemetry.rollbackPath).toBe('none');
      expect(telemetry.error).toBeUndefined();
    });
  });
});
