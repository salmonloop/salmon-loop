import { mkdir, open, unlink } from 'fs/promises';
import { join } from 'path';

import { text } from '../../../locales/index.js';
import { LIMITS } from '../../limits.js';
import { logger } from '../../logger.js';

interface LockMetadata {
  pid: number;
  timestamp: number;
  owner: string;
}

/**
 * Manages file locks to prevent concurrent access to the same repository or files.
 */
export class FileHandleManager {
  private static readonly LOCK_TIMEOUT = LIMITS.worktreePrepareTimeoutMs;
  private static readonly RETRY_DELAY = 100; // 100ms
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
  async acquireLock(repoPath: string, forceUnlock = false): Promise<void> {
    if (
      this.disabled ||
      (process.env.NODE_ENV === 'test' && !process.env.SALMON_ENABLE_LOCK_IN_TEST)
    )
      return;

    const lockFile = join(repoPath, '.salmon.lock');
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

    while (Date.now() - start < FileHandleManager.LOCK_TIMEOUT) {
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

            let isAlive = true;
            try {
              process.kill(metadata.pid, 0);
            } catch {
              isAlive = false;
            }

            if (!isAlive || Date.now() - metadata.timestamp > 300000) {
              await fs.unlink(lockFile);
              continue; // Retry immediately after removing stale lock
            }
          } catch {
            // Fallback to mtime check if metadata is unreadable
            try {
              const fs = await import('fs/promises');
              const stats = await fs.stat(lockFile);
              if (Date.now() - stats.mtimeMs > 300000) {
                await fs.unlink(lockFile);
                continue;
              }
            } catch {
              // Ignore stat errors
            }
          }

          // Exponential backoff: delay increases with retry count, capped at 2000ms
          retryCount++;
          const delay = Math.min(FileHandleManager.RETRY_DELAY * Math.pow(1.5, retryCount), 2000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else if (e.code === 'ENOENT') {
          // Directory might not exist, try to create it
          try {
            await mkdir(repoPath, { recursive: true });
            continue; // Retry immediately
          } catch {
            // If mkdir fails, just wait and retry
          }
          await new Promise((resolve) => setTimeout(resolve, FileHandleManager.RETRY_DELAY));
        } else {
          throw e;
        }
      }
    }

    // Timeout reached - attempt force cleanup before failing
    logger.warn(`Lock acquisition timeout for ${repoPath}, attempting force cleanup...`);
    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(lockFile, 'utf8');
      const metadata: LockMetadata = JSON.parse(content);

      // Log lock holder info for debugging
      logger.warn(
        `Lock held by PID ${metadata.pid}, owner: ${metadata.owner}, age: ${Date.now() - metadata.timestamp}ms`,
      );

      // Force remove the lock file
      await fs.unlink(lockFile);
      logger.warn(`Forcefully removed stale lock file: ${lockFile}`);

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
          logger.info(`Lock acquired after force cleanup: ${lockFile}`);
          return;
        }
      } catch (retryError) {
        logger.warn(
          `Final lock acquisition attempt failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        );
      }
    } catch (cleanupError) {
      logger.warn(
        `Force cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
      );
    }

    throw new Error(text.resource.lockAcquireTimeout(repoPath));
  }

  /**
   * Release a lock for a specific path
   */
  async releaseLock(repoPath: string): Promise<void> {
    if (
      this.disabled ||
      (process.env.NODE_ENV === 'test' && !process.env.SALMON_ENABLE_LOCK_IN_TEST)
    )
      return;

    const lockFile = join(repoPath, '.salmon.lock');
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
        // We don't throw here to avoid masking other errors, but we log it
        logger.warn(text.resource.lockReleaseFailed(repoPath) + `: ${e.message}`);
      }
    }
  }
}
