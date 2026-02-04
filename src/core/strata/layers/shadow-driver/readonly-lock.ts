/**
 * Readonly Lock Manager for ShadowDriver
 *
 * Implements readonly locking for AGGRESSIVE strategy on Linux
 * to prevent hardlink pollution.
 *
 * Also implements concurrent file lock mechanism for shadowRoot.
 */

import { spawn } from 'child_process';
import { mkdir, writeFile, unlink, readFile } from 'fs/promises';
import path from 'path';

import { logger } from '../../../logger.js';
import { normalizePath } from '../../../path.js';
import { getShadowLockPath } from '../../../runtime-paths.js';

/**
 * Acquire a file lock for shadowRoot
 */
export async function acquireLock(shadowRoot: string): Promise<void> {
  const lockPath = getShadowLockPath(shadowRoot);
  const pid = process.pid;
  const timestamp = Date.now();

  try {
    await mkdir(path.dirname(lockPath), { recursive: true });

    // Check if lock exists
    const existingLock = await readFile(lockPath, 'utf8').catch(() => null);
    if (existingLock) {
      const [oldPid, oldTs] = existingLock.split(':').map(Number);
      // Check if process still exists
      const isAlive = await isProcessAlive(oldPid);
      if (isAlive && oldPid !== pid) {
        throw new Error(
          `ShadowRoot is locked by process ${oldPid} since ${new Date(oldTs).toISOString()}`,
        );
      }
      if (isAlive && oldPid === pid) {
        logger.debug(`Lock already held by current process ${pid}`);
        return;
      }
      logger.warn(`Stale lock found for process ${oldPid}, removing...`);
    }

    await writeFile(lockPath, `${pid}:${timestamp}`, { flag: 'w' });
    logger.debug(`Lock acquired for shadowRoot: ${shadowRoot}`);
  } catch (error) {
    logger.error(`Failed to acquire lock: ${error}`);
    throw error;
  }
}

/**
 * Release the file lock
 */
export async function releaseLock(shadowRoot: string): Promise<void> {
  const lockPath = getShadowLockPath(shadowRoot);
  try {
    await unlink(lockPath).catch(() => null);
    logger.debug(`Lock released for shadowRoot: ${shadowRoot}`);
  } catch (error) {
    logger.warn(`Failed to release lock: ${error}`);
  }
}

/**
 * Check if a process is alive
 */
async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Enforce readonly permissions on dependency paths
 */
export async function enforceReadOnly(root: string, depPaths: string[]): Promise<void> {
  if (process.platform !== 'linux') return;

  logger.debug(`Enforcing readonly lock on ${depPaths.length} paths`);

  for (const dep of depPaths) {
    const depPath = normalizePath(`${root}/${dep}`);
    try {
      await exec(`chmod -R a-w "${depPath}"`);
      logger.debug(`Readonly lock applied to ${depPath}`);
    } catch (error) {
      logger.warn(`Failed to apply readonly lock to ${depPath}: ${error}`);
    }
  }
}

/**
 * Restore write permissions for cleanup
 */
export async function restoreWrite(root: string, depPaths: string[]): Promise<void> {
  if (process.platform !== 'linux') return;

  logger.debug(`Restoring write permissions on ${depPaths.length} paths`);

  for (const dep of depPaths) {
    const depPath = normalizePath(`${root}/${dep}`);
    try {
      await exec(`chmod -R u+w "${depPath}"`);
      logger.debug(`Write permissions restored to ${depPath}`);
    } catch (error) {
      logger.warn(`Failed to restore write permissions to ${depPath}: ${error}`);
    }
  }
}

/**
 * Execute command helper
 */
async function exec(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`Command failed: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}: ${stderr}`));
      }
    });

    // Set timeout
    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        reject(new Error(`Command timed out`));
      }
    }, 10000); // 10 seconds
  });
}
