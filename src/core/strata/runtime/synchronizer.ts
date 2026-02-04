import { createHash, randomBytes } from 'crypto';
import { copyFile, mkdir, readFile, rm, stat, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { text } from '../../../locales/index.js';
import { TextNormalizer } from '../../../utils/eol.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { logger } from '../../logger.js';
import { monitor } from '../../monitor.js';
import { ApplyBackOnDirty, CheckpointRef, VerboseLevel } from '../../types.js';
import { CheckpointManager } from '../checkpoint/manager.js';

const SECURITY_BLOCKLIST: RegExp[] = [
  /^\.git(\/|\\)/i,
  /^\.env/i,
  /id_rsa$/i,
  /\.pem$/i,
  /\.key$/i,
];

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.webp',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.bin',
]);

const DEFAULT_MAX_FILE_BYTES = Number(process.env.SALMON_SECURITY_MAX_FILE_BYTES) || 1024 * 1024;

type ApplyBackErrorMeta = Error & { appliedToMain?: boolean };

enum ApplyStrategy {
  ExplicitMerge = 'ExplicitMerge', // git merge-file (Smart, Content-aware)
  AtomicPatch = 'AtomicPatch', // git apply --3way (Topology-aware)
}

export class WorkspaceSynchronizer {
  constructor(private checkpointManager: CheckpointManager) {}

  private normalizePath(value: string): string {
    return value.replace(/\\/g, '/');
  }

  private isBlockedPath(relativePath: string): boolean {
    const normalized = this.normalizePath(relativePath);
    return SECURITY_BLOCKLIST.some((pattern) => pattern.test(normalized));
  }

  private isBinaryPath(relativePath: string): boolean {
    const ext = path.extname(relativePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
  }

  private async shouldAllowPath(
    repoPath: string,
    relativePath: string,
    options?: { allowMissing?: boolean; contentSize?: number },
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (this.isBlockedPath(relativePath)) {
      return { allowed: false, reason: 'blocked-path' };
    }
    try {
      const filePath = path.join(repoPath, ...relativePath.split('/'));
      const fileStat = await stat(filePath);
      if (fileStat.size > DEFAULT_MAX_FILE_BYTES) {
        return { allowed: false, reason: 'size-limit' };
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') {
        if (options?.allowMissing === false) {
          return { allowed: false, reason: 'missing' };
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'stat-failed' };
    }
    return { allowed: true };
  }

  async getChangedPaths(repoPath: string): Promise<string[]> {
    const git = new GitAdapter(repoPath);
    const status = await git.query(['status', '--porcelain', '-z']);
    if (!status) return [];
    const tokens = status.split('\0').filter((token: string) => token.length > 0);
    const paths: string[] = [];
    const extractPath = (entry: string): string => {
      const maybeSep = entry[2];
      if (maybeSep === ' ' || maybeSep === '\t') {
        return entry.slice(3);
      }
      return entry.slice(2);
    };
    for (let i = 0; i < tokens.length; i += 1) {
      const entry = tokens[i];
      const code = entry.slice(0, 2);
      const pathPart = extractPath(entry);
      if (!pathPart) continue;
      if (code.startsWith('R') || code.startsWith('C')) {
        const original = pathPart;
        const renamed = tokens[i + 1];
        if (original) paths.push(original);
        if (renamed) paths.push(renamed);
        i += 1;
        continue;
      }
      paths.push(pathPart);
    }

    const unique = Array.from(new Set(paths.map((p) => this.normalizePath(p))));
    const allowed: string[] = [];
    for (const file of unique) {
      const policy = await this.shouldAllowPath(repoPath, file);
      if (!policy.allowed) {
        logger.warn(text.loop.skipPathDueToPolicy(policy.reason, file));
        continue;
      }
      allowed.push(file);
    }
    return allowed;
  }

  async createCheckpointCommit(
    worktreePath: string,
    taskId: string,
    stepId: string,
  ): Promise<string | null> {
    const changedPaths = await this.getChangedPaths(worktreePath);
    if (changedPaths.length === 0) {
      return null;
    }
    const git = new GitAdapter(worktreePath);
    await git.exec(['add', '--', ...changedPaths]);
    await git.exec([
      '-c',
      'user.name=salmonloop',
      '-c',
      'user.email=salmonloop@local',
      'commit',
      '--no-verify',
      '--no-gpg-sign',
      '-m',
      `checkpoint: ${stepId}`,
    ]);
    const head = await git.query(['rev-parse', 'HEAD']);
    await git.exec(['update-ref', `refs/ai-agent/checkpoints/${taskId}/${stepId}`, head]);
    return head;
  }

  private async analyzeStrategy(
    shadowWorktreePath: string,
    initialRef: string,
    latestRef: string,
  ): Promise<ApplyStrategy> {
    const git = new GitAdapter(shadowWorktreePath);
    // Parse diff status: A=Add, M=Modify, D=Delete, R=Rename, C=Copy, T=Type
    const output = await git.query(['diff', '--name-status', '-z', initialRef, latestRef]);

    if (!output) return ApplyStrategy.ExplicitMerge; // No changes? Default safe

    const tokens = output.split('\0').filter((t) => t.length > 0);
    for (let i = 0; i < tokens.length; i++) {
      const statusToken = tokens[i];
      const status = statusToken.charAt(0);

      // Check topology changes
      if (['R', 'D', 'A', 'C', 'T'].includes(status)) {
        logger.debug(
          `[SmartRoute] Topology change detected (${status}), upgrading to AtomicPatch.`,
        );
        return ApplyStrategy.AtomicPatch;
      }

      const filePath = tokens[i + 1];
      i++; // Skip path

      // Check binary files
      if (filePath && this.isBinaryPath(filePath)) {
        logger.debug(`[SmartRoute] Binary file detected (${filePath}), upgrading to AtomicPatch.`);
        return ApplyStrategy.AtomicPatch;
      }
    }

    logger.debug('[SmartRoute] Pure text modifications detected, using ExplicitMerge.');
    return ApplyStrategy.ExplicitMerge;
  }

  private async applyExplicitMerge(
    mainRepoPath: string,
    shadowWorktreePath: string,
    initialRef: string,
    latestRef: string,
  ): Promise<{ conflicts: string[] }> {
    const shadowGit = new GitAdapter(shadowWorktreePath);
    const mainGit = new GitAdapter(mainRepoPath);
    const conflicts: string[] = [];

    // Get list of modified files (we know they are 'M' only from analysis)
    const output = await shadowGit.query(['diff', '--name-only', '-z', initialRef, latestRef]);
    const files = output.split('\0').filter((f) => f.length > 0);

    for (const relativePath of files) {
      const tempBase = path.join(tmpdir(), `sl-base-${randomBytes(4).toString('hex')}`);
      const tempTheirs = path.join(tmpdir(), `sl-theirs-${randomBytes(4).toString('hex')}`);
      const tempOurs = path.join(tmpdir(), `sl-ours-${randomBytes(4).toString('hex')}`); // For normalization logic if needed

      try {
        // 1. Get Base Content (from Shadow ODB)
        const baseContent = await shadowGit.show(initialRef, relativePath);

        // 2. Get Theirs Content (from Shadow ODB)
        const theirsContent = await shadowGit.show(latestRef, relativePath);

        // 3. Get Ours Content (from Main Working Tree)
        const mainAbsPath = path.join(mainRepoPath, ...relativePath.split('/'));
        let oursContent: Buffer;
        try {
          oursContent = await readFile(mainAbsPath);
        } catch {
          // If file missing in main but modify in shadow -> conflict or re-create?
          // Since we filtered for 'M', it implies it existed in Base. If missing in Main, User deleted it.
          // Merge Modified vs Deleted -> Conflict.
          conflicts.push(relativePath);
          continue;
        }

        // --- EOL Normalization ---
        const oursStr = oursContent.toString('utf8');
        const { eol: targetEOL } = TextNormalizer.read(oursStr);
        const normBase = TextNormalizer.read(baseContent.toString('utf8')).normalized;
        const normTheirs = TextNormalizer.read(theirsContent.toString('utf8')).normalized;
        const normOurs = TextNormalizer.read(oursStr).normalized;

        await writeFile(tempBase, normBase);
        await writeFile(tempTheirs, normTheirs);
        await writeFile(tempOurs, normOurs); // Use normalized ours for merge-file

        // 4. Perform 3-Way Merge
        // git merge-file -p ours base theirs
        const mergeResult = await mainGit.mergeFile(tempBase, tempOurs, tempTheirs);

        // 5. Restore EOL
        const mergedStr = mergeResult.content.toString('utf8');
        const restoredStr = TextNormalizer.restore(mergedStr, targetEOL);

        // 6. Write Back
        await writeFile(mainAbsPath, restoredStr);

        if (mergeResult.hasConflict) {
          logger.warn(`[ExplicitMerge] Conflict detected in ${relativePath}`);
          conflicts.push(relativePath);
        }
      } catch (err) {
        logger.error(`[ExplicitMerge] Failed to merge ${relativePath}: ${err}`);
        throw err;
      } finally {
        // Cleanup temps
        await Promise.all([
          unlink(tempBase).catch(() => {}),
          unlink(tempTheirs).catch(() => {}),
          unlink(tempOurs).catch(() => {}),
        ]);
      }
    }

    return { conflicts };
  }

  private async applyAtomicPatch(
    mainRepoPath: string,
    shadowWorktreePath: string,
    initialRef: string,
    latestRef: string,
  ): Promise<void> {
    const git = new GitAdapter(shadowWorktreePath);
    const diffText = await git.query(
      ['diff', '--binary', '--no-color', '--no-ext-diff', initialRef, latestRef],
      { trim: false },
    );

    if (!diffText.trim()) return;

    const mainGit = new GitAdapter(mainRepoPath);
    try {
      await mainGit.applyPatch(diffText, {
        threeWay: true,
        contextLines: 3,
        preserveIndexLines: false,
      });
    } catch (error) {
      throw new Error(
        `Apply-back completed with conflicts (Atomic Patch). Rejection files (.rej) have been generated. Original error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private parseStatusEntries(status: string): {
    xy: string;
    path: string;
    origPath?: string;
  }[] {
    if (!status) return [];
    return status
      .split('\n')
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const xy = line.slice(0, 2);
        const rawPath = line.length > 2 ? line.slice(2).trimStart() : '';
        if (rawPath.includes('->')) {
          const [orig, dest] = rawPath.split('->').map((value) => value.trim());
          return { xy, path: dest, origPath: orig };
        }
        return { xy, path: rawPath };
      })
      .filter((entry) => entry.path.length > 0);
  }

  async applyBackToMainWorkspace(
    mainRepoPath: string,
    checkpointRef: CheckpointRef,
    diffText: string,
    applyBackOnDirty: ApplyBackOnDirty = '3way',
    verbose?: VerboseLevel,
    changedFiles?: string[],
    shadowInitialRef?: string | null,
    shadowLatestRef?: string | null,
    _includePaths: string[] = [],
  ): Promise<void> {
    const startTime = Date.now();
    let applySuccess = false;
    let applyError: Error | undefined;
    let appliedToMain = false;
    let dirtyBackup: {
      dir: string;
      untrackedFiles: string[];
      trackedFiles: string[];
      deletedFiles: string[];
      stagedPatchPath?: string;
    } | null = null;
    let didBeginApply = false;

    // Fingerprints are used to detect whether applyBack mutated the main workspace.
    // If nothing changed, we must not run rollback logic (which itself can be destructive to staged/dirty state).
    type WorkspaceFingerprint = {
      head: string;
      index: string;
      working: string;
      untracked: string;
    };
    let fingerprintFn: (() => Promise<WorkspaceFingerprint>) | null = null;
    let originalFingerprint: WorkspaceFingerprint | null = null;

    try {
      // Smart Routing Logic: Determine Strategy
      // If we have Shadow Refs, we can choose between Explicit Merge and Atomic Patch
      let strategy = ApplyStrategy.AtomicPatch; // Fallback default

      if (shadowInitialRef && shadowLatestRef) {
        strategy = await this.analyzeStrategy(
          checkpointRef.worktreePath,
          shadowInitialRef,
          shadowLatestRef,
        );
        logger.info(`[applyBack] Smart Routing selected strategy: ${strategy}`);
      }

      // Force AtomicPatch if applyBackOnDirty is 'abort' or other strict modes?
      // Actually, ExplicitMerge is SAFER for dirty workspaces because it does 3-way content merge.
      // But if user requested 'abort' on dirty, we check dirty below anyway.

      // Pre-flight check for dirty workspace
      const git = new GitAdapter(mainRepoPath);
      // Use standard porcelain (v1) for compatibility
      const status = await git.query(['status', '--porcelain']);
      const trimmedStatus = status.trim();
      const isDirty = trimmedStatus.length > 0;

      if (isDirty && applyBackOnDirty === 'abort') {
        throw new Error(text.loop.applyBackAbortedDirty(trimmedStatus));
      }

      // --- Safety: Backup Dirty State ---
      // We implement "Undo Log" pattern: Backup -> Apply -> Restore if Fail
      // This applies to BOTH strategies to ensure atomicity via rollback

      const hashContent = (value: string | Buffer): string =>
        createHash('sha256').update(value).digest('hex');
      const normalizeFilePath = (value: string): string => value.replace(/\\/g, '/');

      const computeFingerprint = async (): Promise<{
        head: string;
        index: string;
        working: string;
        untracked: string;
      }> => {
        const head = await git.query(['rev-parse', 'HEAD']);
        const index = await git.query(['write-tree']);
        const workingDiff = await git.query(['diff', '--binary', '--no-color', '--no-ext-diff']);
        const working = hashContent(workingDiff);
        const untrackedOutput = await git.query(['ls-files', '--others', '--exclude-standard']);
        const untrackedFiles = untrackedOutput
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0)
          .sort();
        let untracked = '';
        if (untrackedFiles.length > 0) {
          const entries: string[] = [];
          for (const file of untrackedFiles) {
            try {
              const content = await readFile(path.join(mainRepoPath, ...file.split('/')));
              entries.push(`${file}:${hashContent(content)}`);
            } catch {
              entries.push(`${file}:missing`);
            }
          }
          untracked = hashContent(entries.join('\n'));
        } else {
          untracked = hashContent('');
        }
        return { head, index, working, untracked };
      };

      fingerprintFn = computeFingerprint;
      originalFingerprint = await computeFingerprint();

      // Always create dirty backup if dirty and policy is 3way
      // This protects against partial failures in ExplicitMerge loop AND AtomicPatch
      if (isDirty && applyBackOnDirty === '3way') {
        const createDirtyBackup = async () => {
          const backupDir = path.join(
            tmpdir(),
            `salmon-loop-backup-${Date.now()}-${randomBytes(4).toString('hex')}`,
          );
          await mkdir(backupDir, { recursive: true });

          const stagedPatch = await git.query(['diff', '--cached', '--binary']);
          let stagedPatchPath: string | undefined;
          if (stagedPatch.trim()) {
            stagedPatchPath = path.join(backupDir, 'staged.patch');
            await writeFile(stagedPatchPath, stagedPatch);
          }

          const unstagedPatch = await git.query(['diff', '--binary']);
          if (unstagedPatch.trim()) {
            await writeFile(path.join(backupDir, 'unstaged.patch'), unstagedPatch);
          }

          // Simple full file backup for dirty tracked files (robustness)
          const statusEntries = this.parseStatusEntries(trimmedStatus);
          const isDeleted = (xy: string): boolean => xy.includes('D');
          const dirtyFiles = statusEntries
            .filter((e) => e.xy !== '??' && !isDeleted(e.xy))
            .map((e) => normalizeFilePath(e.path));
          const deletedFiles = statusEntries
            .filter((e) => e.xy !== '??' && isDeleted(e.xy))
            .map((e) => normalizeFilePath(e.path));

          if (dirtyFiles.length > 0) {
            const trackedDir = path.join(backupDir, 'tracked');
            for (const file of dirtyFiles) {
              const src = path.join(mainRepoPath, ...file.split('/'));
              const dst = path.join(trackedDir, ...file.split('/'));
              await mkdir(path.dirname(dst), { recursive: true });
              try {
                await copyFile(src, dst);
              } catch {
                // Ignore backup failure for deleted files
              }
            }
          }

          // Backup untracked
          const untrackedFiles = (await git.query(['ls-files', '--others', '--exclude-standard']))
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
          if (untrackedFiles.length > 0) {
            const untrackedDir = path.join(backupDir, 'untracked');
            for (const file of untrackedFiles) {
              const src = path.join(mainRepoPath, ...file.split('/'));
              const dst = path.join(untrackedDir, ...file.split('/'));
              await mkdir(path.dirname(dst), { recursive: true });
              await copyFile(src, dst);
            }
          }

          // Metadata
          await writeFile(path.join(backupDir, 'status.txt'), trimmedStatus);
          return {
            dir: backupDir,
            trackedFiles: dirtyFiles,
            untrackedFiles,
            deletedFiles,
            stagedPatchPath,
          };
        };

        dirtyBackup = (await createDirtyBackup()) as any;
        logger.warn(text.loop.applyBackCheckpointLocation(dirtyBackup?.dir || ''));
      }

      // --- EXECUTION PHASE ---

      try {
        didBeginApply = true;
        if (shadowInitialRef && shadowLatestRef) {
          if (strategy === ApplyStrategy.ExplicitMerge) {
            logger.info('[applyBack] Executing ExplicitMerge (Smart Routing)');
            const result = await this.applyExplicitMerge(
              mainRepoPath,
              checkpointRef.worktreePath,
              shadowInitialRef,
              shadowLatestRef,
            );
            if (result.conflicts.length > 0) {
              logger.warn(
                `[applyBack] ExplicitMerge completed with ${result.conflicts.length} conflicts.`,
              );
              // NOTE: We do NOT throw here. Markers are in the files.
              // This is "Success with Conflicts".
            }
          } else {
            logger.info('[applyBack] Executing AtomicPatch (Smart Routing)');
            await this.applyAtomicPatch(
              mainRepoPath,
              checkpointRef.worktreePath,
              shadowInitialRef,
              shadowLatestRef,
            );
          }
        } else {
          // Fallback if no shadow refs (legacy flow or raw patch)
          // Always use Atomic Patch for raw diffs
          logger.info('[applyBack] Executing Raw Patch Apply');
          const git = new GitAdapter(mainRepoPath);
          await git.applyPatch(diffText, { threeWay: true });
        }

        appliedToMain = true;
        applySuccess = true;
      } catch (err) {
        applyError = err as Error;
        throw applyError;
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (!didBeginApply) {
        (err as ApplyBackErrorMeta).appliedToMain = appliedToMain;
        throw err;
      }

      // If applyBack did not mutate the workspace, do not run rollback routines.
      // This prevents "rollback" from becoming the thing that corrupts the user's state.
      let workspaceChanged = true;
      if (fingerprintFn && originalFingerprint) {
        try {
          const current = await fingerprintFn();
          workspaceChanged =
            current.head !== originalFingerprint.head ||
            current.index !== originalFingerprint.index ||
            current.working !== originalFingerprint.working ||
            current.untracked !== originalFingerprint.untracked;
        } catch {
          // If fingerprinting fails, assume changed to be safe.
          workspaceChanged = true;
        }
      }

      if (!workspaceChanged) {
        (err as ApplyBackErrorMeta).appliedToMain = appliedToMain;
        throw err;
      }

      // Rollback Logic
      if (dirtyBackup) {
        logger.warn(text.loop.applyBackRollbackAttempt);
        logger.warn(text.loop.checkpointLocation(dirtyBackup.dir));
        const git = new GitAdapter(mainRepoPath);

        // Best-effort cleanup: even if git is in a conflicted/unmerged state, we must still restore files.
        await git.exec(['reset', '--hard', 'HEAD'], { allowError: true });
        await git.exec(['clean', '-fd', '-e', '.salmonloop'], { allowError: true });

        // Re-apply deletions from the original dirty state (T1).
        for (const file of dirtyBackup.deletedFiles) {
          await rm(path.join(mainRepoPath, ...file.split('/')), {
            recursive: true,
            force: true,
          }).catch(() => {});
        }

        // Restore tracked files from the backup snapshot (authoritative for dirty preservation).
        if (dirtyBackup.trackedFiles) {
          const trackedDir = path.join(dirtyBackup.dir, 'tracked');
          for (const file of dirtyBackup.trackedFiles) {
            try {
              await copyFile(
                path.join(trackedDir, ...file.split('/')),
                path.join(mainRepoPath, ...file.split('/')),
              );
            } catch (e) {
              logger.error(
                `[applyBack] Failed to restore tracked file ${file}: ${e instanceof Error ? e.message : String(e)}`,
              );
            }
          }
        }

        // Restore untracked files (best-effort).
        if (dirtyBackup.untrackedFiles) {
          const untrackedDir = path.join(dirtyBackup.dir, 'untracked');
          for (const file of dirtyBackup.untrackedFiles) {
            try {
              await copyFile(
                path.join(untrackedDir, ...file.split('/')),
                path.join(mainRepoPath, ...file.split('/')),
              );
            } catch {
              // Ignore restore errors for untracked files
            }
          }
        }

        // CRITICAL SAFETY: Restore staged/index state to preserve user intent.
        if (dirtyBackup.stagedPatchPath) {
          try {
            await git.exec(['apply', '--cached', '--binary', dirtyBackup.stagedPatchPath]);
          } catch (e) {
            logger.error(
              `[applyBack] CRITICAL: Failed to restore staged state from backup. ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }

        await git.exec(['update-index', '--refresh'], { allowError: true });
      } else {
        // Workspace was clean at entry, but applyBack still wrote something (e.g. conflict markers).
        // Revert to HEAD best-effort.
        const git = new GitAdapter(mainRepoPath);
        await git.exec(['reset', '--hard', 'HEAD'], { allowError: true });
        await git.exec(['clean', '-fd', '-e', '.salmonloop'], { allowError: true });
        await git.exec(['update-index', '--refresh'], { allowError: true });
      }

      (err as ApplyBackErrorMeta).appliedToMain = appliedToMain;
      throw err;
    } finally {
      // Record monitoring metrics
      const duration = Date.now() - startTime;
      monitor.recordApplyBack(applySuccess, duration);
      logger.info(`applyBack completed in ${duration}ms, success: ${applySuccess}`);
    }
  }
}
