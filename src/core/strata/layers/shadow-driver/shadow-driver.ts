/**
 * ShadowDriver - Main Implementation
 *
 * Core implementation of Layer 2 ShadowDriver following v2.0 specification.
 */

import { rm } from 'fs/promises';
import { mkdir } from 'fs/promises';
import { join } from 'path';

import { logger } from '../../../logger.js';
import { normalizePath } from '../../../path.js';
import type { ShadowDriverConfig, ShadowEnvResult, ShadowTask } from '../../types.js';

import { copyDir, linkDirLinux } from './copy-backend.js';
import { getEnvInjection } from './env.js';
import { isEnvironmentError } from './error-classifier.js';
import { enforceReadOnly, restoreWrite, acquireLock, releaseLock } from './readonly-lock.js';
import { determineStrategy, planDependencyPaths } from './strategy.js';

/**
 * ShadowDriver Class
 */
export class ShadowDriver {
  constructor(private config: ShadowDriverConfig) {}

  /**
   * Setup dependency environment for task execution
   */
  async setup(task: ShadowTask): Promise<ShadowEnvResult> {
    // Acquire concurrency lock
    await acquireLock(this.config.shadowRoot);

    const strategy = determineStrategy(task, this.config.whitelist);
    const depPaths = await planDependencyPaths(this.config);

    logger.debug(`ShadowDriver setup: strategy=${strategy}, depPaths=${depPaths.join(',')}`);

    // Prepare dependency directories
    await this.prepareDependencyDirs(depPaths);

    if (strategy === 'ISOLATED') {
      // pnpm optimization: if pnpm-lock.yaml exists, we can use pnpm's store
      const { existsSync } = await import('fs');
      if (existsSync(join(this.config.repoRoot, 'pnpm-lock.yaml'))) {
        logger.debug('pnpm project detected, using pnpm optimization');
        // In a real implementation, we might set PNPM_HOME or use --offline
        // For now, we proceed with standard copy but mark the intent
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
        logger.warn(`Failed to create dependency directory ${depPath}: ${error}`);
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
        logger.debug(`Copied dependency: ${dep}`);
      } catch (error) {
        logger.error(`Failed to copy dependency ${dep}: ${error}`);
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
        logger.debug(`Linked dependency: ${dep}`);
      } catch (error) {
        logger.error(`Failed to link dependency ${dep}: ${error}`);
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

    logger.debug(`Command executed successfully: ${task.command}`);
  } catch (error) {
    if (isFallback) throw error;

    if (isEnvironmentError(error)) {
      logger.debug(`Environment error detected, triggering fallback: ${error}`);
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
  const { GitAdapter } = await import('../../../adapters/git/git-adapter.js');
  const adapter = new GitAdapter(cwd);

  // Use adapter to execute arbitrary commands while respecting the global lock
  // We use sh -c to support the shell string command
  await adapter.exec(['sh', '-c', command], { env: env as any });
}

/**
 * Cleanup shadow environment
 */
async function cleanup(root: string, depPaths?: string[]): Promise<void> {
  const normalizedRoot = normalizePath(root);

  logger.debug(`Cleaning up shadow environment: ${normalizedRoot}`);

  // Restore write permissions if needed
  if (process.platform === 'linux' && depPaths?.length) {
    await restoreWrite(root, depPaths);
  }

  // Release concurrency lock
  await releaseLock(root);

  // Remove shadow directory
  try {
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    logger.debug(`Successfully cleaned up shadow environment: ${normalizedRoot}`);
  } catch (error) {
    logger.error(`Failed to cleanup shadow environment ${normalizedRoot}: ${error}`);
    throw error;
  }
}
