import { randomBytes } from 'crypto';
import { access, realpath, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join, normalize, relative } from 'path';

import { text } from '../../../locales/index.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { logger } from '../../observability/logger.js';
import { RunOptions, ExecutionWorkspace, LoopEvent } from '../../types/index.js';

/**
 * WorkspaceManager - Manages execution workspace for different checkpoint strategies
 *
 * Supports two strategies:
 * - 'direct': Operates directly on the repository
 * - 'worktree': Creates a temporary git worktree for isolated execution
 */
export class WorkspaceManager {
  /**
   * Setup execution workspace based on strategy
   * @param options RunOptions with optional strategy
   * @param initialCommit Optional commit hash to base the worktree on (defaults to HEAD)
   * @param onEvent Optional event callback for reporting progress
   * @returns ExecutionWorkspace configuration
   */
  static async setup(
    options: RunOptions,
    initialCommit?: string,
    onEvent?: (event: LoopEvent) => void,
  ): Promise<ExecutionWorkspace> {
    const strategy = options.strategy || 'direct';
    const git = new GitAdapter(options.repoPath);

    if (strategy === 'worktree') {
      const baseRef = initialCommit || (await git.query(['rev-parse', 'HEAD']));
      const repoName = basename(options.repoPath);
      const timestamp = Date.now();
      const random = randomBytes(4).toString('hex');
      const worktreePath = join(tmpdir(), `s8p-wt/${repoName}/${timestamp}-${random}`);

      const tmpDir = normalize(tmpdir());
      const normalizedWorktreePath = normalize(worktreePath);

      if (!normalizedWorktreePath.startsWith(tmpDir)) {
        throw new Error('Worktree path must be in system temp directory');
      }
      if (!relative(options.repoPath, worktreePath).startsWith('..')) {
        throw new Error('Worktree path must not be inside repo path');
      }

      // Use GitAdapter for worktree creation
      await git.query(['worktree', 'add', '--quiet', '--detach', worktreePath, baseRef.trim()]);

      onEvent?.({
        type: 'workspace.ready',
        strategy: 'worktree',
        path: worktreePath,
        timestamp: new Date(),
      });

      logger.debug(`Created worktree at: ${worktreePath}`);
      return {
        baseRepoPath: options.repoPath,
        workPath: worktreePath,
        strategy: 'worktree',
      };
    }

    // Default direct strategy
    onEvent?.({
      type: 'workspace.ready',
      strategy: 'direct',
      path: options.repoPath,
      timestamp: new Date(),
    });

    return {
      baseRepoPath: options.repoPath,
      workPath: options.repoPath,
      strategy: 'direct',
    };
  }

  /**
   * Teardown execution workspace and clean up resources
   * @param workspace ExecutionWorkspace to teardown
   * @param onEvent Optional event callback
   */
  static async teardown(
    workspace: ExecutionWorkspace,
    onEvent?: (event: LoopEvent) => void,
  ): Promise<void> {
    if (workspace.strategy !== 'worktree') {
      logger.debug(`Teardown workspace (strategy: ${workspace.strategy}) - no action needed`);
      return;
    }

    if (workspace.workPath === workspace.baseRepoPath) {
      onEvent?.({
        type: 'resource.status',
        resource: 'worktree',
        status: 'skipped',
        message: text.resource.worktreeSkipCleanup,
        timestamp: new Date(),
      });
      return;
    }

    const git = new GitAdapter(workspace.baseRepoPath);
    let removed = false;

    try {
      const list = await git.query(['worktree', 'list', '--porcelain']);
      const worktreePaths = list
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length).trim())
        .filter(Boolean);

      const normalizeForCompare = (value: string) => {
        const normalized = normalize(value).replace(/\\/g, '/');
        if (process.platform === 'darwin' && normalized.startsWith('/private/')) {
          return normalized.slice('/private'.length);
        }
        return normalized;
      };

      const tryRealpath = async (value: string) => {
        try {
          return await realpath(value);
        } catch {
          return null;
        }
      };

      const targetNorm = normalizeForCompare(workspace.workPath);
      const exactMatch =
        worktreePaths.find((p) => p === workspace.workPath) ||
        worktreePaths.find((p) => normalizeForCompare(p) === targetNorm);

      let matchPath: string | null = exactMatch ?? null;
      if (!matchPath) {
        const targetReal = await tryRealpath(workspace.workPath);
        if (targetReal) {
          for (const p of worktreePaths) {
            const pReal = await tryRealpath(p);
            if (pReal && pReal === targetReal) {
              matchPath = p;
              break;
            }
          }
        }
      }

      if (matchPath) {
        await git.query(['worktree', 'remove', '--force', matchPath]);
        removed = true;

        const directoryStillExists = await (async () => {
          try {
            await access(workspace.workPath);
            return true;
          } catch (error: any) {
            if (error && typeof error === 'object' && (error as any).code === 'ENOENT') {
              return false;
            }
            // For non-ENOENT errors, assume the path may still exist.
            return true;
          }
        })();

        if (directoryStillExists) {
          removed = false;
          logger.debug(
            `git worktree remove reported success but directory still exists; falling back to fs.rm: ${workspace.workPath}`,
          );
        } else {
          logger.debug(`Removed worktree: ${matchPath}`);
        }
      } else {
        onEvent?.({
          type: 'resource.status',
          resource: 'worktree',
          status: 'warning',
          message: text.resource.worktreeNotFoundInList(workspace.workPath),
          timestamp: new Date(),
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      onEvent?.({
        type: 'action.fallback',
        tool: 'git',
        method: 'worktree remove',
        reason: msg,
        severity: 'low',
        timestamp: new Date(),
      });
      logger.debug(`git worktree remove failed, falling back to filesystem removal: ${msg}`);
    }

    if (!removed) {
      const tmpDir = normalize(tmpdir());
      const normalizedWorktreePath = normalize(workspace.workPath);
      if (!normalizedWorktreePath.startsWith(tmpDir)) {
        throw new Error('Worktree path not in temp directory, refusing to delete');
      }
      await rm(workspace.workPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      logger.debug(`Successfully cleaned up worktree directory via fs.rm: ${workspace.workPath}`);
    }
  }
}
