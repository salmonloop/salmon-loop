/**
 * Readonly Lock Manager for ShadowDriver
 *
 * Implements readonly locking for AGGRESSIVE strategy on Linux
 * to prevent hardlink pollution.
 *
 * Also implements concurrent file lock mechanism for shadowRoot.
 */

import { randomBytes } from 'crypto';
import path from 'path';

import { mkdir, writeFile, unlink, readFile, rename } from '../../../adapters/fs/node-fs.js';
import { getLogger } from '../../../observability/logger.js';
import { getShadowLockPath } from '../../../runtime/paths.js';
import { spawnCommand } from '../../../runtime/process-runner.js';
import { normalizePath } from '../../../utils/path.js';

const ownedLockTokens = new Map<string, string>();

/**
 * Acquire a file lock for shadowRoot
 */
export async function acquireLock(shadowRoot: string): Promise<void> {
  const lockPath = getShadowLockPath(shadowRoot);
  const pid = process.pid;
  const timestamp = Date.now();

  try {
    await mkdir(path.dirname(lockPath), { recursive: true });
    const lockPayload = `${pid}:${timestamp}:${randomBytes(4).toString('hex')}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await writeFile(lockPath, lockPayload, { flag: 'wx' });
        ownedLockTokens.set(lockPath, lockPayload);
        getLogger().debug(`Lock acquired for shadowRoot: ${shadowRoot}`);
        return;
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (
          (err && typeof err === 'object' && 'code' in err
            ? (err as { code?: string }).code
            : undefined) !== 'EEXIST'
        ) {
          throw error;
        }

        const existingLock = await readFile(lockPath, 'utf8').catch(() => null);
        if (!existingLock) {
          continue;
        }

        const [oldPid, oldTs] = existingLock.split(':').map(Number);
        if (!Number.isFinite(oldPid) || oldPid <= 0) {
          await removeLockByToken(lockPath, existingLock);
          continue;
        }

        const isAlive = await isProcessAlive(oldPid);
        if (isAlive && oldPid !== pid) {
          const lockSince = formatLockTimestamp(oldTs);
          throw new Error(`ShadowRoot is locked by process ${oldPid} since ${lockSince}`);
        }
        if (isAlive && oldPid === pid) {
          ownedLockTokens.set(lockPath, existingLock);
          getLogger().debug(`Lock already held by current process ${pid}`);
          return;
        }

        getLogger().warn(`Stale lock found for process ${oldPid}, removing...`);
        await removeLockByToken(lockPath, existingLock);
      }
    }

    throw new Error('Failed to acquire lock due to concurrent lock updates');
  } catch (error) {
    getLogger().error(`Failed to acquire lock: ${error}`);
    throw error;
  }
}

/**
 * Release the file lock
 */
export async function releaseLock(shadowRoot: string): Promise<void> {
  const lockPath = getShadowLockPath(shadowRoot);
  const ownedToken = ownedLockTokens.get(lockPath);
  if (!ownedToken) {
    getLogger().warn(`Skip releasing unowned lock: ${shadowRoot}`);
    return;
  }

  try {
    const removed = await removeLockByToken(lockPath, ownedToken);
    if (!removed) {
      getLogger().warn(`Skip releasing lock due to ownership mismatch: ${shadowRoot}`);
      ownedLockTokens.delete(lockPath);
      return;
    }

    ownedLockTokens.delete(lockPath);
    getLogger().debug(`Lock released for shadowRoot: ${shadowRoot}`);
  } catch (error) {
    getLogger().warn(`Failed to release lock: ${error}`);
  }
}

/**
 * Check if a process is alive
 */
async function isProcessAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const message = err?.message || '';
    if (
      (err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined) === 'ESRCH' ||
      message.includes('ESRCH')
    )
      return false;
    if (
      (err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined) === 'EPERM' ||
      message.includes('EPERM')
    )
      return true;
    return true;
  }
}

function formatLockTimestamp(value: number): string {
  if (!Number.isFinite(value)) return 'unknown-time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown-time';
  return date.toISOString();
}

async function removeLockByToken(lockPath: string, expectedToken: string): Promise<boolean> {
  const swapPath = `${lockPath}.swap-${process.pid}-${randomBytes(4).toString('hex')}`;

  try {
    await rename(lockPath, swapPath);
  } catch {
    return false;
  }

  try {
    const movedToken = await readFile(swapPath, 'utf8');
    if (movedToken === expectedToken) {
      await unlink(swapPath);
      return true;
    }

    try {
      await rename(swapPath, lockPath);
    } catch {
      // Best-effort rollback when concurrent updates happen.
      await unlink(swapPath).catch(() => null);
    }
    return false;
  } catch {
    try {
      await rename(swapPath, lockPath);
    } catch {
      // Best-effort rollback when concurrent updates happen.
      await unlink(swapPath).catch(() => null);
    }
    return false;
  }
}

/**
 * Enforce readonly permissions on dependency paths
 */
export async function enforceReadOnly(root: string, depPaths: string[]): Promise<void> {
  if (process.platform !== 'linux') return;

  getLogger().debug(`Enforcing readonly lock on ${depPaths.length} paths`);

  for (const dep of depPaths) {
    const depPath = normalizePath(`${root}/${dep}`);
    try {
      await execChmod('a-w', depPath);
      getLogger().debug(`Readonly lock applied to ${depPath}`);
    } catch (error) {
      getLogger().warn(`Failed to apply readonly lock to ${depPath}: ${error}`);
    }
  }
}

/**
 * Restore write permissions for cleanup
 */
export async function restoreWrite(root: string, depPaths: string[]): Promise<void> {
  if (process.platform !== 'linux') return;

  getLogger().debug(`Restoring write permissions on ${depPaths.length} paths`);

  for (const dep of depPaths) {
    const depPath = normalizePath(`${root}/${dep}`);
    try {
      await execChmod('u+w', depPath);
      getLogger().debug(`Write permissions restored to ${depPath}`);
    } catch (error) {
      getLogger().warn(`Failed to restore write permissions to ${depPath}: ${error}`);
    }
  }
}

/**
 * Execute command helper
 */
async function execChmod(mode: string, targetPath: string): Promise<void> {
  let stderr = '';
  const result = await spawnCommand({
    command: 'chmod',
    args: ['-R', mode, targetPath],
    timeoutMs: 10000,
    onStderrChunk: (chunk) => {
      stderr += Buffer.from(chunk).toString();
    },
  });

  if (result.error) {
    throw new Error(`Command failed: ${result.error.message}`);
  }
  if (result.timedOut) {
    throw new Error('Command timed out');
  }
  if (result.code === 0) {
    return;
  }

  throw new Error(`Command failed with code ${result.code}: ${stderr}`);
}
