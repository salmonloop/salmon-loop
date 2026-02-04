import path from 'path';

import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { logger } from '../../logger.js';
import { normalizePath } from '../../path.js';
import { getRejectionsDir, getTmpDir } from '../../runtime-paths.js';
import type { IFileSystemProvider, SyntheticSidecarLayer } from '../../strata/types.js';
import type { VerboseLevel } from '../../types.js';
import { CheckpointManager } from '../checkpoint/manager.js';
import { StrataContentGuardian } from '../interaction/content-guardian.js';
import { StrataFileSystemProvider } from '../interaction/file-system-provider.js';

export interface ShadowMergeEngineOptions {
  mainRepoPath: string;
  shadowWorktreePath: string;
  initialRef: string;
  latestRef: string;
  verbose?: VerboseLevel;
  maxFileBytes?: number;
  applyBackOnDirty?: 'abort' | '3way' | 'dirtySnapshot';
  shouldAllowPath?: (
    path: string,
    contentSize?: number,
  ) => Promise<{ allowed: boolean; reason?: string }>;
  fileSystemProvider?: IFileSystemProvider;
}

export class ShadowMergeEngine {
  private readonly options: ShadowMergeEngineOptions;
  private readonly checkpoints: CheckpointManager;
  private readonly sidecar: SyntheticSidecarLayer;
  private readonly gitAdapter: GitAdapter;
  private readonly guardian: StrataContentGuardian;
  private readonly fsp: IFileSystemProvider;

  constructor(
    options: ShadowMergeEngineOptions,
    checkpoints: CheckpointManager,
    sidecar?: SyntheticSidecarLayer,
  ) {
    this.options = options;
    this.checkpoints = checkpoints;
    this.sidecar = sidecar ?? createNoopSidecar();
    this.gitAdapter = new GitAdapter(options.mainRepoPath);
    this.guardian = new StrataContentGuardian();
    this.fsp = options.fileSystemProvider ?? new StrataFileSystemProvider(this.gitAdapter);
  }

  async apply(): Promise<void> {
    const { mainRepoPath, shadowWorktreePath, initialRef, latestRef } = this.options;

    // L3: SyntheticSidecarLayer Injection
    await this.sidecar.inject(shadowWorktreePath);

    // Strategy Pattern Implementation
    const strategy = this.options.applyBackOnDirty || 'abort';

    // Check if workspace is dirty
    const isDirty = await this.isWorkspaceDirty(mainRepoPath);

    if (isDirty && strategy === 'abort') {
      throw new Error(text.loop.workspaceDirtyAbort);
    }

    if (isDirty && strategy === '3way') {
      logger.warn(text.loop.using3WayMergeStrategy);
    }

    // Zero Trust Workflow: Pre-Flight (Safety)
    logger.debug('[ShadowMergeEngine] Creating snapshot for atomic transaction');
    const snapshot = await this.checkpoints.createSafeSnapshot(mainRepoPath);

    // T1: Dirty Transaction Backup (Captured early to satisfy Atomicity Contract and Unit Tests)
    const t1BackupHash = await this.checkpoints.createDirtyBackup(mainRepoPath);
    if (t1BackupHash) {
      logger.debug(`[ShadowMergeEngine] Created T1 Dirty Backup: ${t1BackupHash}`);
    }

    try {
      const diffEntries = await this.getShadowDiffEntries(
        shadowWorktreePath,
        initialRef,
        latestRef,
      );

      const operations: { type: 'A' | 'M' | 'D'; path: string }[] = [];
      for (const entry of diffEntries) {
        if (entry.status === 'R' || entry.status === 'C') {
          if (entry.oldPath) {
            operations.push({ type: 'D', path: entry.oldPath });
          }
          operations.push({ type: 'A', path: entry.path });
          continue;
        }
        if (entry.status === 'A' || entry.status === 'M' || entry.status === 'D') {
          operations.push({ type: entry.status, path: entry.path });
        }
      }

      if (operations.length === 0) {
        return;
      }

      const conflicts: string[] = [];
      const skipped: string[] = [];
      const maxFileBytes = this.options.maxFileBytes ?? 1024 * 1024;

      for (const op of operations) {
        const policy = await this.shouldAllowPath(op.path);
        if (!policy.allowed) {
          skipped.push(`${op.path} (${policy.reason})`);
          continue;
        }

        const status = await this.getStatusForPath(mainRepoPath, op.path);
        const hasUserChanges = status
          ? status.staged || status.unstaged || status.untracked
          : false;

        if (op.type === 'A') {
          const aiContent = await this.gitShowFile(shadowWorktreePath, latestRef, op.path);
          if (!aiContent) {
            skipped.push(`${op.path} (missing-ai)`);
            continue;
          }
          if (aiContent.length > maxFileBytes) {
            skipped.push(`${op.path} (size-limit)`);
            continue;
          }

          if (hasUserChanges) {
            const ignored = await this.isIgnoredPath(mainRepoPath, op.path);
            if (ignored) {
              const userWorkingPath = path.join(mainRepoPath, op.path);
              /**
               * 🛡️ CONTROLLED IO: Explicitly pass mainRepoPath as rootContext
               * to prevent AI-driven path traversal to system files.
               */
              const userWorkingContent = await this.fsp.readFileBufferSafe(
                userWorkingPath,
                mainRepoPath,
              );
              if (userWorkingContent) {
                const isBinary =
                  (await this.isBinaryPath(mainRepoPath, op.path, userWorkingContent)) ||
                  (await this.isBinaryPath(shadowWorktreePath, op.path, aiContent));
                if (isBinary) {
                  skipped.push(`${op.path} (binary)`);
                  continue;
                }
                const emptyBase = Buffer.alloc(0);
                logger.warn(text.loop.unionMergeWarning(op.path));
                const workingMerge = await this.mergeFileContents(
                  mainRepoPath,
                  emptyBase,
                  userWorkingContent,
                  aiContent,
                  { union: true },
                );
                await this.fsp.writeFile(userWorkingPath, workingMerge.merged, mainRepoPath);
                continue;
              }
            }
            conflicts.push(op.path);
            continue;
          }

          const destPath = path.join(mainRepoPath, op.path);
          try {
            await this.fsp.mkdir(path.dirname(destPath), { recursive: true }, mainRepoPath);
            await this.fsp.writeFile(destPath, aiContent, mainRepoPath);
          } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err?.code === 'EISDIR' || err?.code === 'EEXIST' || err?.code === 'ENOTDIR') {
              conflicts.push(`${op.path} (fs-collision)`);
              continue;
            }
            throw error;
          }
          continue;
        }

        if (op.type === 'D') {
          if (hasUserChanges) {
            conflicts.push(op.path);
            continue;
          }
          const targetPath = path.join(mainRepoPath, op.path);
          try {
            await this.fsp.unlink(targetPath, mainRepoPath);
          } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err?.code !== 'ENOENT') {
              throw error;
            }
          }
          continue;
        }

        // Merge logic
        if (status?.deleted && !status?.untracked) {
          conflicts.push(op.path);
          continue;
        }

        if (status?.untracked) {
          const userWorkingPath = path.join(mainRepoPath, op.path);
          const userWorkingContent = await this.fsp.readFileBufferSafe(
            userWorkingPath,
            mainRepoPath,
          );
          if (!userWorkingContent) {
            conflicts.push(op.path);
            continue;
          }
        }

        const baseContent = await this.getBaseContent(shadowWorktreePath, initialRef, op.path);
        const aiContent = await this.gitShowFile(shadowWorktreePath, latestRef, op.path);
        if (!baseContent || !aiContent) {
          conflicts.push(op.path);
          continue;
        }

        const userWorkingPath = path.join(mainRepoPath, op.path);
        const userWorkingContent = await this.fsp.readFileBufferSafe(userWorkingPath, mainRepoPath);
        if (!userWorkingContent) {
          conflicts.push(op.path);
          continue;
        }

        const isBinary =
          (await this.isBinaryPath(shadowWorktreePath, op.path, aiContent)) ||
          (await this.isBinaryPath(mainRepoPath, op.path, userWorkingContent));
        if (isBinary) {
          skipped.push(`${op.path} (binary)`);
          continue;
        }

        const workingMerge = await this.mergeFileContents(
          mainRepoPath,
          baseContent,
          userWorkingContent,
          aiContent,
        );
        await this.fsp.writeFile(userWorkingPath, workingMerge.merged, mainRepoPath);
        if (workingMerge.conflict) {
          conflicts.push(op.path);
        }
      }

      if (skipped.length > 0) {
        logger.warn(text.loop.skippedFiles(skipped.join(', ')));
      }

      if (conflicts.length > 0) {
        const rejectionsDir = getRejectionsDir(mainRepoPath);
        await this.fsp.mkdir(rejectionsDir, { recursive: true }, mainRepoPath);
        for (const conflictPath of conflicts) {
          try {
            const aiContent = await this.gitShowFile(shadowWorktreePath, latestRef, conflictPath);
            if (aiContent) {
              const rejFullPath = path.join(rejectionsDir, `${conflictPath}.rej`);
              await this.fsp.mkdir(path.dirname(rejFullPath), { recursive: true }, mainRepoPath);
              await this.fsp.writeFile(rejFullPath, aiContent, mainRepoPath);
            }
          } catch (e) {
            logger.error(`Failed to generate rejection for ${conflictPath}: ${e}`);
          }
        }
        throw new Error(
          text.loop.applyBackCompletedWithConflicts(conflicts.length, conflicts.join(', ')),
        );
      }

      logger.debug('[ShadowMergeEngine] Transaction completed successfully');
    } catch (error) {
      logger.error(`[ShadowMergeEngine] Transaction failed, rolling back: ${error}`);
      if (t1BackupHash) {
        await this.checkpoints.restoreDirtyBackup(mainRepoPath, t1BackupHash);
      } else {
        await this.checkpoints.restoreToMain(mainRepoPath, snapshot.commitHash, true);
      }
      throw error;
    }
  }

  private async shouldAllowPath(
    relativePath: string,
    contentSize?: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (!this.options.shouldAllowPath) return { allowed: true };
    return this.options.shouldAllowPath(relativePath, contentSize);
  }

  private async getBaseContent(
    worktreePath: string,
    ref: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    const base = await this.gitShowFile(worktreePath, ref, relativePath);
    if (base) return base;
    if (this.sidecar.has(relativePath)) {
      return this.sidecar.get(relativePath);
    }
    return null;
  }

  private async isBinaryPath(
    repoPath: string,
    relativePath: string,
    content?: Buffer,
  ): Promise<boolean> {
    const ext = path.extname(relativePath).toLowerCase();
    const binaryExtensions = [
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.bmp',
      '.ico',
      '.pdf',
      '.zip',
      '.tar',
      '.gz',
      '.7z',
      '.exe',
      '.dll',
      '.so',
      '.dylib',
      '.bin',
      '.dat',
    ];
    if (binaryExtensions.includes(ext)) return true;
    if (content) return this.guardian.inspect(content).isBinary;
    try {
      const filePath = path.join(repoPath, relativePath);
      const buffer = await this.fsp.readFileBufferSafe(filePath, repoPath);
      if (!buffer) return false;
      return this.guardian.inspect(buffer).isBinary;
    } catch {
      return false;
    }
  }

  private async isIgnoredPath(repoPath: string, relativePath: string): Promise<boolean> {
    const normalized = normalizePath(relativePath);
    return await this.gitAdapter.checkIgnore(normalized);
  }

  private async gitShowFile(
    repoPath: string,
    ref: string,
    relativePath: string,
  ): Promise<Buffer | null> {
    const git = repoPath === this.options.mainRepoPath ? this.gitAdapter : new GitAdapter(repoPath);
    try {
      return await git.show(ref, relativePath);
    } catch {
      return null;
    }
  }

  private async mergeFileContents(
    repoPath: string,
    baseContent: Buffer,
    userContent: Buffer,
    aiContent: Buffer,
    _options: { union?: boolean } = {},
  ): Promise<{ merged: Buffer; conflict: boolean }> {
    const { normalized: normBase } = this.guardian.inspect(baseContent);
    const { normalized: normUser, eol: detectedEOL } = this.guardian.inspect(userContent);
    const { normalized: normAi } = this.guardian.inspect(aiContent);

    const finalTargetEOL = detectedEOL;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tmpDir = getTmpDir(repoPath);
    const basePath = path.join(tmpDir, `base-${suffix}`);
    const userPath = path.join(tmpDir, `user-${suffix}`);
    const aiPath = path.join(tmpDir, `ai-${suffix}`);

    /**
     * 🛡️ TMP FILES: Still within the repo sandbox for git merge-file
     * but using atomic FSP to ensure cleanup and safety.
     */
    await this.fsp.mkdir(tmpDir, { recursive: true }, repoPath);
    await this.fsp.writeFile(basePath, normBase, repoPath);
    await this.fsp.writeFile(userPath, normUser, repoPath);
    await this.fsp.writeFile(aiPath, normAi, repoPath);

    try {
      const result = await this.gitAdapter.mergeFile(basePath, userPath, aiPath, {
        union: _options.union,
      });

      const mergedStr = result.content.toString('utf8');
      const restoredBuffer = this.guardian.restore(mergedStr, finalTargetEOL);

      return {
        merged: restoredBuffer,
        conflict: result.hasConflict,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`git merge-file failed: ${msg}`);
    } finally {
      await this.fsp.unlink(basePath, repoPath).catch(() => {});
      await this.fsp.unlink(userPath, repoPath).catch(() => {});
      await this.fsp.unlink(aiPath, repoPath).catch(() => {});
    }
  }

  private async getStatusForPath(
    repoPath: string,
    relativePath: string,
  ): Promise<{ staged: boolean; unstaged: boolean; untracked: boolean; deleted: boolean } | null> {
    const git = new GitAdapter(repoPath);
    return await git.getStatusForPath(relativePath);
  }

  private async getShadowDiffEntries(
    worktreePath: string,
    initialRef: string,
    latestRef: string,
  ): Promise<{ status: string; path: string; oldPath?: string }[]> {
    const git = new GitAdapter(worktreePath);
    const output = await git.query(['diff', '--name-status', '-z', initialRef, latestRef]);
    if (!output) return [];
    const tokens = output.split('\0').filter((token: string) => token.length > 0);
    const entries: { status: string; path: string; oldPath?: string }[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const statusToken = tokens[i];
      const status = statusToken.charAt(0);
      if (status === 'R' || status === 'C') {
        const oldPath = tokens[i + 1];
        const newPath = tokens[i + 2];
        if (oldPath && newPath) {
          entries.push({
            status,
            path: normalizePath(newPath),
            oldPath: normalizePath(oldPath),
          });
        }
        i += 2;
        continue;
      }
      const pathToken = tokens[i + 1];
      if (pathToken) {
        entries.push({ status, path: normalizePath(pathToken) });
      }
      i += 1;
    }
    return entries;
  }

  private async isWorkspaceDirty(repoPath: string): Promise<boolean> {
    try {
      const git = new GitAdapter(repoPath);
      const status = await git.query(['status', '--porcelain']);
      return status.trim().length > 0;
    } catch (error) {
      logger.error(`Failed to check workspace status: ${error}`);
      return false;
    }
  }
}

function createNoopSidecar(): SyntheticSidecarLayer {
  return {
    async capture() {},
    async inject() {},
    has() {
      return false;
    },
    async get() {
      return null;
    },
    async clear() {},
  };
}
