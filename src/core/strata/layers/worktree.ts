import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';

import { text } from '../../../locales/index.js';
import { access, readdir, realpath, rm } from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { getLogger } from '../../observability/logger.js';
import { RunOptions, ExecutionWorkspace, LoopEvent } from '../../types/index.js';
import { isPathWithinDirectory, normalizePath } from '../../utils/path.js';

import { detectDependencyPaths } from './shadow-driver/strategy.js';

function resolveEnvironmentMode(options: Pick<RunOptions, 'environmentMode'>): 'strict' | 'parity' {
  return options.environmentMode === 'parity' ? 'parity' : 'strict';
}

function isWindowsAbsolutePath(p: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

function selectPathImpl(p: string): path.PlatformPath {
  const normalized = normalizePath(p);
  if (!normalized) return path;
  if (isWindowsAbsolutePath(normalized)) return path.win32;
  if (normalized.startsWith('/')) return path.posix;
  return path;
}

function resolveParityWorktreeRoot(repoPath: string): string {
  const impl = selectPathImpl(repoPath);
  const normalizedRepoPath = normalizePath(repoPath);
  return normalizePath(
    impl.join(impl.dirname(impl.resolve(normalizedRepoPath)), '.salmonloop', 'worktrees'),
  );
}

function isManagedWorktreePath(baseRepoPath: string, workPath: string): boolean {
  const comparableWorkPath = normalizePathForCompare(workPath);
  const managedRoots = [tmpdir(), resolveParityWorktreeRoot(baseRepoPath)];

  return managedRoots.some((root) =>
    isPathWithinDirectory(normalizePathForCompare(root), comparableWorkPath, {
      allowEqual: false,
    }),
  );
}

function normalizePathForCompare(value: string): string {
  const normalized = path.normalize(value).replace(/\\/g, '/');
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

async function removeProjectedWorktreeEntries(workPath: string): Promise<void> {
  let worktreeRealPath: string;
  try {
    worktreeRealPath = await realpath(workPath);
  } catch (error) {
    throw new Error(
      `Failed to resolve worktree path before git cleanup (${workPath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let entries: Array<{ name: string }> = [];
  try {
    entries = (await readdir(workPath, { withFileTypes: true })) as Array<{ name: string }>;
  } catch (error) {
    throw new Error(
      `Failed to enumerate worktree entries before git cleanup (${workPath}): ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const entriesToRemove: string[] = [];
  for (const entry of entries) {
    const name = entry?.name;
    if (!name || name === '.git') continue;

    const entryPath = path.join(workPath, name);
    const entryRealPath = await tryRealpath(entryPath);
    if (!entryRealPath) continue;
    if (isPathWithinDirectory(worktreeRealPath, entryRealPath, { allowEqual: false })) {
      continue;
    }

    entriesToRemove.push(entryPath);
  }

  for (let i = 0; i < entriesToRemove.length; i += 10) {
    const chunk = entriesToRemove.slice(i, i + 10);
    await Promise.all(
      chunk.map(async (entryPath) => {
        await rm(entryPath, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
        getLogger().debug(`Removed projected worktree entry before git cleanup: ${entryPath}`);
      }),
    );
  }
}

async function pruneWorktreeDependencyRoots(
  baseRepoPath: string,
  worktreePath: string,
): Promise<void> {
  const dependencyPaths = await detectDependencyPaths(baseRepoPath);

  for (let i = 0; i < dependencyPaths.length; i += 10) {
    const chunk = dependencyPaths.slice(i, i + 10);
    await Promise.all(
      chunk.map(async (dependencyPath) => {
        const dependencyRoot = path.join(worktreePath, dependencyPath);
        try {
          await rm(dependencyRoot, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          });
          getLogger().debug(
            `Pruned disposable dependency root before worktree cleanup: ${dependencyRoot}`,
          );
        } catch (error) {
          getLogger().debug(
            `Failed to prune dependency root before worktree cleanup (${dependencyRoot}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
  }
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
      const repoPathImpl = selectPathImpl(options.repoPath);
      const repoName = repoPathImpl.basename(normalizePath(options.repoPath));
      const timestamp = Date.now();
      const random = randomBytes(4).toString('hex');
      const environmentMode = resolveEnvironmentMode(options);
      const worktreeRootImpl =
        environmentMode === 'parity' ? selectPathImpl(options.repoPath) : selectPathImpl(tmpdir());
      const rootDir =
        environmentMode === 'parity'
          ? worktreeRootImpl.join(resolveParityWorktreeRoot(options.repoPath), repoName)
          : worktreeRootImpl.join(tmpdir(), `s8p-wt/${repoName}`);
      const worktreePath = worktreeRootImpl.join(rootDir, `${timestamp}-${random}`);
      const normalizedWorktreePath = worktreeRootImpl.normalize(worktreePath);

      if (environmentMode === 'parity') {
        const parityRoot = worktreeRootImpl.normalize(resolveParityWorktreeRoot(options.repoPath));
        if (!isPathWithinDirectory(parityRoot, normalizedWorktreePath, { allowEqual: false })) {
          throw new Error(text.errors.worktreePathMustBeUnderParityRoot);
        }
      } else {
        const tmpDir = worktreeRootImpl.normalize(tmpdir());
        if (!isPathWithinDirectory(tmpDir, normalizedWorktreePath, { allowEqual: false })) {
          throw new Error(text.errors.worktreePathMustBeInTempDir);
        }
      }
      if (isPathWithinDirectory(options.repoPath, worktreePath, { allowEqual: true })) {
        throw new Error(text.errors.worktreePathMustNotBeInsideRepo);
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

    // CRITICAL SAFETY: refuse any destructive cleanup outside managed worktree roots.
    if (!isManagedWorktreePath(workspace.baseRepoPath, workspace.workPath)) {
      throw new Error(text.errors.worktreePathNotInManagedRoots);
    }

    const git = new GitAdapter(workspace.baseRepoPath);
    let removed = false;

    try {
      await pruneWorktreeDependencyRoots(workspace.baseRepoPath, workspace.workPath);

      const list = await git.query(['worktree', 'list', '--porcelain']);
      const worktreePaths = list
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length).trim())
        .filter(Boolean);

      const matchPath = await resolveWorktreeMatchPath(worktreePaths, workspace.workPath);

      if (matchPath) {
        // CRITICAL SAFETY: if projection inspection fails, do not risk git traversing external roots.
        await removeProjectedWorktreeEntries(workspace.workPath);
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
