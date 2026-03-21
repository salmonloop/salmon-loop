/**
 * ShadowDriver - Main Implementation
 *
 * Core implementation of Layer 2 ShadowDriver following v2.0 specification.
 */

import { join } from 'path';

import { existsSync } from '../../../adapters/fs/node-fs.js';
import { lstat, mkdir, realpath, rm, symlink } from '../../../adapters/fs/node-fs.js';
import { getLogger } from '../../../observability/logger.js';
import { spawnCommand } from '../../../runtime/process-runner.js';
import { arePathsEquivalent, normalizePath } from '../../../utils/path.js';
import { getPlatformShellInvocation } from '../../../utils/platform-shell.js';
import type { ShadowDriverConfig, ShadowEnvResult, ShadowTask } from '../../types.js';

import { copyDir, linkDirLinux } from './copy-backend.js';
import { getEnvInjection } from './env.js';
import { isEnvironmentError } from './error-classifier.js';
import { enforceReadOnly, restoreWrite, acquireLock, releaseLock } from './readonly-lock.js';
import { determineStrategy, planDependencyPaths, detectDependencyPaths } from './strategy.js';

const DEPENDENCY_LINK_CONFLICT_CODES = new Set([
  'EEXIST',
  'EISDIR',
  'ENOTEMPTY',
  'ENOTDIR',
  'EPERM',
]);

function getErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? (error as { code?: string }).code
    : undefined;
}

async function pointsToExpectedDependency(
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  try {
    await lstat(targetPath);
    const [resolvedSourcePath, resolvedTargetPath] = await Promise.all([
      realpath(sourcePath),
      realpath(targetPath),
    ]);
    return arePathsEquivalent(resolvedSourcePath, resolvedTargetPath);
  } catch {
    return false;
  }
}

/**
 * ShadowDriver Class
 */
export class ShadowDriver {
  constructor(private config: ShadowDriverConfig) {}

  /**
   * Hydrate a target directory with dependencies from a source repository.
   * This projects the environment (node_modules, venv, etc.) into the target
   * using cross-platform symlinks (junctions).
   *
   * Used by: Worktree Strategy (L1) to prepare the execution environment (L2).
   */
  static async hydrate(repoRoot: string, targetRoot: string): Promise<void> {
    const depPaths = await detectDependencyPaths(repoRoot);

    if (depPaths.length === 0) {
      getLogger().debug('No dependencies detected to hydrate.');
      return;
    }

    getLogger().debug(`Hydrating environment: ${depPaths.join(', ')} -> ${targetRoot}`);

    for (const depPath of depPaths) {
      const sourcePath = join(repoRoot, depPath);
      const targetDepPath = join(targetRoot, depPath);

      if (!existsSync(sourcePath)) {
        continue;
      }

      try {
        // Use 'junction' for Windows compatibility (no admin rights needed usually)
        await symlink(sourcePath, targetDepPath, 'junction');
        getLogger().debug(`Linked dependency: ${depPath}`);
      } catch (err: unknown) {
        const errorCode = getErrorCode(err);
        if (errorCode && DEPENDENCY_LINK_CONFLICT_CODES.has(errorCode)) {
          const alreadyProjected = await pointsToExpectedDependency(sourcePath, targetDepPath);
          if (alreadyProjected) {
            getLogger().debug(`Dependency projection already matches source: ${depPath}`);
            continue;
          }

          throw new Error(
            `Dependency projection path conflict for ${depPath}: ${err instanceof Error ? err.message : String(err)}`,
          );
        } else {
          getLogger().warn(
            `Failed to link ${depPath}: ${err instanceof Error ? err.message : String(err)}`,
          );
          throw err instanceof Error ? err : new Error(String(err));
        }
      }
    }
  }

  /**
   * Setup dependency environment for task execution
   */
  async setup(task: ShadowTask): Promise<ShadowEnvResult> {
    // Acquire concurrency lock
    await acquireLock(this.config.shadowRoot);

    const strategy = determineStrategy(task, this.config.whitelist);
    const depPaths = await planDependencyPaths(this.config);

    getLogger().debug(`ShadowDriver setup: strategy=${strategy}, depPaths=${depPaths.join(',')}`);

    // Prepare dependency directories
    await this.prepareDependencyDirs(depPaths);

    if (strategy === 'ISOLATED') {
      if (
        existsSync(join(this.config.repoRoot, 'bun.lock')) ||
        existsSync(join(this.config.repoRoot, 'bun.lockb'))
      ) {
        getLogger().debug('bun project detected');
      }
      await this.copyDependencies(depPaths);
    } else if (strategy === 'AGGRESSIVE') {
      await this.linkDependencies(depPaths);
      if (this.config.readonly) await enforceReadOnly(this.config.shadowRoot, depPaths);
    }
    // OPTIMIZED strategy doesn't require copying/linking

    return {
      shadowPath: this.config.shadowRoot,
      strategy,
      fallbackApplied: false,
      readonlyLocked: strategy === 'AGGRESSIVE' && this.config.readonly,
      dependencyPaths: depPaths,
    };
  }

  /**
   * Run task with driver environment
   */
  async run(task: ShadowTask): Promise<void> {
    return runWithDriver(task, this.config);
  }

  /**
   * Cleanup shadow environment
   */
  async cleanup(depPaths?: string[]): Promise<void> {
    await cleanup(this.config.shadowRoot, depPaths);
  }

  /**
   * Prepare dependency directories in shadow root
   */
  private async prepareDependencyDirs(depPaths: string[]): Promise<void> {
    for (const dep of depPaths) {
      const depPath = join(this.config.shadowRoot, dep);
      try {
        // Create the directory itself to ensure copy contents works correctly (paired with cp src/. dest)
        await mkdir(depPath, { recursive: true });
      } catch (error) {
        getLogger().warn(`Failed to create dependency directory ${depPath}: ${error}`);
      }
    }
  }

  /**
   * Copy dependencies for ISOLATED strategy
   */
  private async copyDependencies(depPaths: string[]): Promise<void> {
    for (const dep of depPaths) {
      const srcPath = join(this.config.repoRoot, dep);
      const destPath = join(this.config.shadowRoot, dep);

      try {
        await copyDir(srcPath, destPath, this.config.platform);
        getLogger().debug(`Copied dependency: ${dep}`);
      } catch (error) {
        getLogger().error(`Failed to copy dependency ${dep}: ${error}`);
        throw error;
      }
    }
  }

  /**
   * Link dependencies for AGGRESSIVE strategy
   */
  private async linkDependencies(depPaths: string[]): Promise<void> {
    if (this.config.platform !== 'linux') {
      throw new Error('AGGRESSIVE strategy only supported on Linux');
    }

    for (const dep of depPaths) {
      const srcPath = join(this.config.repoRoot, dep);
      const destPath = join(this.config.shadowRoot, dep);

      try {
        await linkDirLinux(srcPath, destPath);
        getLogger().debug(`Linked dependency: ${dep}`);
      } catch (error) {
        getLogger().error(`Failed to link dependency ${dep}: ${error}`);
        throw error;
      }
    }
  }
}

/**
 * Run task with driver environment (with fallback support)
 */
async function runWithDriver(
  task: ShadowTask,
  ctx: ShadowDriverConfig,
  isFallback = false,
): Promise<void> {
  const driver = new ShadowDriver(ctx);
  let depPaths: string[] | undefined;

  try {
    const result = await driver.setup(task);
    depPaths = result.dependencyPaths;

    // Execute command with injected environment
    const env = getEnvInjection(ctx.repoRoot);
    await executeCommand(task.command, ctx.shadowRoot, env);

    getLogger().debug(`Command executed successfully: ${task.command}`);
  } catch (error) {
    if (isFallback) throw error;

    if (isEnvironmentError(error)) {
      getLogger().debug(`Environment error detected, triggering fallback: ${error}`);
      await cleanup(ctx.shadowRoot, depPaths);
      return runWithDriver({ ...task, forceIsolation: true }, ctx, true);
    }

    throw error;
  }
}

/**
 * Execute command in shadow environment
 */
async function executeCommand(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  const shell = getPlatformShellInvocation(command);
  let stderr = '';
  const result = await spawnCommand({
    command: shell.file,
    args: shell.args,
    cwd,
    env,
    onStderrChunk: (chunk) => {
      stderr += Buffer.from(chunk).toString();
    },
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  if (!result.timedOut && result.code === 0) {
    return;
  }

  if (result.timedOut) {
    throw new Error('command timed out');
  }

  const message = stderr.trim() || `command failed with exit code ${String(result.code)}`;
  throw new Error(message);
}

/**
 * Cleanup shadow environment
 */
async function cleanup(root: string, depPaths?: string[]): Promise<void> {
  const normalizedRoot = normalizePath(root);

  getLogger().debug(`Cleaning up shadow environment: ${normalizedRoot}`);

  // Restore write permissions if needed
  if (process.platform === 'linux' && depPaths?.length) {
    await restoreWrite(root, depPaths);
  }

  // Release concurrency lock
  await releaseLock(root);

  // Remove shadow directory
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    getLogger().debug(`Successfully cleaned up shadow environment: ${normalizedRoot}`);
  } catch (error) {
    getLogger().error(`Failed to cleanup shadow environment ${normalizedRoot}: ${error}`);
    throw error;
  }
}
