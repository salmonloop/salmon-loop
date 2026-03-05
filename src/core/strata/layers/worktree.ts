import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { basename, dirname, join, normalize, resolve } from 'path';

import { text } from '../../../locales/index.js';
import { access, realpath, rm } from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { getLogger } from '../../observability/logger.js';
import { RunOptions, ExecutionWorkspace, LoopEvent } from '../../types/index.js';
import { isPathWithinDirectory } from '../../utils/path.js';

function resolveEnvironmentMode(options: Pick<RunOptions, 'environmentMode'>): 'strict' | 'parity' {
  return options.environmentMode === 'parity' ? 'parity' : 'strict';
}

function resolveParityWorktreeRoot(repoPath: string): string {
  return join(dirname(resolve(repoPath)), '.salmonloop', 'worktrees');
}

function isManagedWorktreePath(baseRepoPath: string, workPath: string): boolean {
  if (isPathWithinDirectory(tmpdir(), workPath, { allowEqual: false })) return true;
  const parityRoot = resolveParityWorktreeRoot(baseRepoPath);
  if (isPathWithinDirectory(parityRoot, workPath, { allowEqual: false })) return true;
  return false;
}

function normalizePathForCompare(value: string): string {
  const normalized = normalize(value).replace(/\\/g, '/');
  if (process.platform === 'darwin' && normalized.startsWith('/private/')) {
    return normalized.slice('/private'.length);
  }
  return normalized;
}

async function tryRealpath(value: string): Promise<string | null> {
  try {
    return await realpath(value);
  } catch {
    return null;
  }
}

async function resolveWorktreeMatchPath(
  worktreePaths: string[],
  targetPath: string,
): Promise<string | null> {
  const targetNorm = normalizePathForCompare(targetPath);
  const exactMatch =
    worktreePaths.find((p) => p === targetPath) ||
    worktreePaths.find((p) => normalizePathForCompare(p) === targetNorm);
  if (exactMatch) return exactMatch;

  const targetReal = await tryRealpath(targetPath);
  if (!targetReal) return null;

  for (const candidate of worktreePaths) {
    const candidateReal = await tryRealpath(candidate);
    if (candidateReal && candidateReal === targetReal) {
      return candidate;
    }
  }
  return null;
}

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
      const environmentMode = resolveEnvironmentMode(options);
      const rootDir =
        environmentMode === 'parity'
          ? join(resolveParityWorktreeRoot(options.repoPath), repoName)
          : join(tmpdir(), `s8p-wt/${repoName}`);
      const worktreePath = join(rootDir, `${timestamp}-${random}`);
      const normalizedWorktreePath = normalize(worktreePath);

      if (environmentMode === 'parity') {
        const parityRoot = normalize(resolveParityWorktreeRoot(options.repoPath));
        if (!isPathWithinDirectory(parityRoot, normalizedWorktreePath, { allowEqual: false })) {
          throw new Error('Worktree path must be under parity worktree root');
        }
      } else {
        const tmpDir = normalize(tmpdir());
        if (!isPathWithinDirectory(tmpDir, normalizedWorktreePath, { allowEqual: false })) {
          throw new Error('Worktree path must be in system temp directory');
        }
      }
      if (isPathWithinDirectory(options.repoPath, worktreePath, { allowEqual: true })) {
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

      getLogger().debug(`Created worktree at: ${worktreePath}`);
      return {
        baseRepoPath: options.repoPath,
        workPath: worktreePath,
        strategy: 'worktree',
        environmentMode,
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
      environmentMode: resolveEnvironmentMode(options),
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
      getLogger().debug(`Teardown workspace (strategy: ${workspace.strategy}) - no action needed`);
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

      const matchPath = await resolveWorktreeMatchPath(worktreePaths, workspace.workPath);

      if (matchPath) {
        await git.query(['worktree', 'remove', '--force', matchPath]);
        removed = true;

        const directoryStillExists = await (async () => {
          try {
            await access(workspace.workPath);
            return true;
          } catch (error: unknown) {
            if (error && typeof error === 'object' && (error as any).code === 'ENOENT') {
              return false;
            }
            return true;
          }
        })();

        if (directoryStillExists) {
          removed = false;
          getLogger().debug(
            `git worktree remove reported success but directory still exists; falling back to fs.rm: ${workspace.workPath}`,
          );
        } else {
          getLogger().debug(`Removed worktree: ${matchPath}`);
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
      const msg =
        error instanceof Error
          ? error instanceof Error
            ? error.message
            : String(error)
          : String(error);
      onEvent?.({
        type: 'action.fallback',
        tool: 'git',
        method: 'worktree remove',
        reason: msg,
        severity: 'low',
        timestamp: new Date(),
      });
      getLogger().debug(`git worktree remove failed, falling back to filesystem removal: ${msg}`);
    }

    if (!removed) {
      if (!isManagedWorktreePath(workspace.baseRepoPath, workspace.workPath)) {
        throw new Error('Worktree path not in managed roots, refusing to delete');
      }
      await rm(workspace.workPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      getLogger().debug(
        `Successfully cleaned up worktree directory via fs.rm: ${workspace.workPath}`,
      );
    }
  }
}
