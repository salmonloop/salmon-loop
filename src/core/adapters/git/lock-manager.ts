import { mkdir, open, unlink } from 'fs/promises';
import { join } from 'path';

import { text } from '../../../locales/index.js';
import { LIMITS } from '../../limits.js';
import { logger } from '../../logger.js';
import { LoopEvent } from '../../types.js';

interface LockMetadata {
  pid: number;
  timestamp: number;
  owner: string;
}

/**
 * Manages file locks to prevent concurrent access to the same repository or files.
 */
export class FileHandleManager {
  private disabled = false;
  private currentOwner = `process-${process.pid}`;

  /**
   * Disable locking (useful for tests)
   */
  disable(): void {
    this.disabled = true;
  }

  /**
   * Acquire a lock for a specific path (usually the repo root)
   */
  async acquireLock(
    repoPath: string,
    forceUnlock = false,
    onEvent?: (event: LoopEvent) => void,
  ): Promise<void> {
    if (
      this.disabled ||
      (process.env.NODE_ENV === 'test' && !process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST)
    )
      return;

    const lockFile = join(repoPath, '.salmonloop.lock');
    const start = Date.now();
    let retryCount = 0;

    if (forceUnlock) {
      try {
        const fs = await import('fs/promises');
        await fs.unlink(lockFile);
      } catch {
        // Ignore
      }
    }

    while (Date.now() - start < LIMITS.lockWaitTimeoutMs) {
      try {
        // Try to create the lock file with O_EXCL to ensure atomicity
        const handle = await open(lockFile, 'wx');
        if (handle) {
          const metadata: LockMetadata = {
            pid: process.pid,
            timestamp: Date.now(),
            owner: this.currentOwner,
          };
          await handle.writeFile(JSON.stringify(metadata), 'utf8');
          await handle.close();
          return;
        }
      } catch (e: any) {
        if (e.code === 'EEXIST') {
          // Check if the lock is stale or the process is dead
          try {
            const fs = await import('fs/promises');
            const content = await fs.readFile(lockFile, 'utf8');
            const metadata: LockMetadata = JSON.parse(content);
            const isSelfLock = metadata.pid === process.pid && metadata.owner === this.currentOwner;

            let isAlive = true;
            try {
              process.kill(metadata.pid, 0);
            } catch {
              isAlive = false;
            }

            // Never auto-remove a lock owned by the current process.
            // If we did, concurrent calls within the same process could break mutual exclusion.
            if (
              !isAlive ||
              (!isSelfLock && Date.now() - metadata.timestamp > LIMITS.lockStaleThresholdMs)
            ) {
              await fs.unlink(lockFile);
              continue; // Retry immediately after removing stale lock
            }
          } catch {
            // If the lock file is unreadable, we cannot safely determine ownership.
            // Do not auto-remove in this path; rely on timeout-based recovery instead.
          }

          // Exponential backoff: delay increases with retry count, capped at 2000ms
          retryCount++;
          const delay = Math.min(
            LIMITS.retry.io.initialDelayMs * Math.pow(1.5, retryCount),
            LIMITS.retry.io.maxDelayMs,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else if (e.code === 'ENOENT') {
          // Directory might not exist, try to create it
          try {
            await mkdir(repoPath, { recursive: true });
            continue; // Retry immediately
          } catch {
            // If mkdir fails, just wait and retry
          }
          await new Promise((resolve) => setTimeout(resolve, LIMITS.retry.io.initialDelayMs));
        } else {
          throw e;
        }
      }
    }

    // Timeout reached - attempt force cleanup before failing
    onEvent?.({
      type: 'resource.status',
      resource: 'lock',
      status: 'warning',
      message: text.resource.lockTimeoutAttemptForce(repoPath),
      timestamp: new Date(),
    });

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(lockFile, 'utf8');
      const metadata: LockMetadata = JSON.parse(content);
      const isSelfLock = metadata.pid === process.pid && metadata.owner === this.currentOwner;

      // Log lock holder info to file for debugging
      const age = Date.now() - metadata.timestamp;
      logger.debug(`Lock held by PID ${metadata.pid}, owner: ${metadata.owner}, age: ${age}ms`);

      // Only force remove if it's actually stale
      if (!isSelfLock && age > LIMITS.lockStaleThresholdMs) {
        await fs.unlink(lockFile);
        onEvent?.({
          type: 'resource.status',
          resource: 'lock',
          status: 'recovered',
          message: text.resource.lockForceRemoved(lockFile),
          timestamp: new Date(),
        });

        // One final attempt to acquire the lock
        try {
          const handle = await open(lockFile, 'wx');
          if (handle) {
            const newMetadata: LockMetadata = {
              pid: process.pid,
              timestamp: Date.now(),
              owner: this.currentOwner,
            };
            await handle.writeFile(JSON.stringify(newMetadata), 'utf8');
            await handle.close();
            onEvent?.({
              type: 'resource.status',
              resource: 'lock',
              status: 'recovered',
              message: text.resource.lockAcquiredAfterForce(lockFile),
              timestamp: new Date(),
            });
            return;
          }
        } catch (retryError) {
          logger.debug(`Final lock acquisition attempt failed: ${retryError}`);
        }
      } else {
        logger.debug(
          `Lock is not stale (age: ${age}ms < ${LIMITS.lockStaleThresholdMs}ms), skipping force removal`,
        );
      }
    } catch (cleanupError) {
      logger.debug(`Force cleanup failed: ${cleanupError}`);
    }

    throw new Error(text.resource.lockAcquireTimeout(repoPath));
  }

  /**
   * Release a lock for a specific path
   */
  async releaseLock(repoPath: string, onEvent?: (event: LoopEvent) => void): Promise<void> {
    if (
      this.disabled ||
      (process.env.NODE_ENV === 'test' && !process.env.SALMONLOOP_ENABLE_LOCK_IN_TEST)
    )
      return;

    const lockFile = join(repoPath, '.salmonloop.lock');
    try {
      // Verify ownership before releasing
      try {
        const fs = await import('fs/promises');
        const content = await fs.readFile(lockFile, 'utf8');
        const metadata: LockMetadata = JSON.parse(content);
        if (metadata.owner !== this.currentOwner) {
          return; // Not the owner
        }
      } catch {
        // If we can't read it, proceed to try unlink anyway (it might be missing)
      }
      await unlink(lockFile);
    } catch (e: any) {
      if (e.code !== 'ENOENT') {
        // We don't throw here to avoid masking other errors, but we report it via event
        onEvent?.({
          type: 'resource.status',
          resource: 'lock',
          status: 'warning',
          message: text.resource.lockReleaseFailed(repoPath) + `: ${e.message}`,
          timestamp: new Date(),
        });
      }
    }
  }
}
