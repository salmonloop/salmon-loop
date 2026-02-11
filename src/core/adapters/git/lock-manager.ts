import { randomBytes } from 'crypto';
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
  private currentOwner = `process-${process.pid}-${randomBytes(8).toString('hex')}`;
  private localLocks = new Map<string, { locked: boolean; waiters: Array<() => void> }>();

  private async abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return;
    if (signal.aborted) return;

    await new Promise<void>((resolve) => {
      const onAbort = () => {
        cleanup();
        resolve();
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };

      signal.addEventListener('abort', onAbort);
    });
  }

  private async acquireLocal(lockFile: string): Promise<void> {
    const state = this.localLocks.get(lockFile) ?? { locked: false, waiters: [] };
    this.localLocks.set(lockFile, state);
    if (!state.locked) {
      state.locked = true;
      return;
    }
    await new Promise<void>((resolve) => {
      state.waiters.push(resolve);
    });
  }

  private releaseLocal(lockFile: string): void {
    const state = this.localLocks.get(lockFile);
    if (!state) return;
    const next = state.waiters.shift();
    if (next) {
      next();
      return;
    }
    state.locked = false;
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      const message = err?.message || '';
      if (err?.code === 'ESRCH' || message.includes('ESRCH')) return false;
      if (err?.code === 'EPERM' || message.includes('EPERM')) return true;
      return true;
    }
  }

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
    await this.acquireLocal(lockFile);

    const start = Date.now();
    let retryCount = 0;
    const hardTimeoutMs = LIMITS.lockAcquireHardTimeoutMs;
    const abortState = { aborted: false };
    const hardAbort = new AbortController();

    const core = async (): Promise<void> => {
      if (forceUnlock) {
        try {
          const fs = await import('fs/promises');
          await fs.unlink(lockFile);
        } catch {
          // Ignore
        }
      }

      while (Date.now() - start < LIMITS.lockWaitTimeoutMs) {
        if (abortState.aborted) throw new Error(text.resource.lockAcquireHardTimeout(repoPath));
        try {
          // Try to create the lock file with O_EXCL to ensure atomicity
          const handle = await open(lockFile, 'wx');
          if (abortState.aborted) {
            await handle.close().catch(() => {});
            await unlink(lockFile).catch(() => {});
            throw new Error(text.resource.lockAcquireHardTimeout(repoPath));
          }
          const metadata: LockMetadata = {
            pid: process.pid,
            timestamp: Date.now(),
            owner: this.currentOwner,
          };
          await handle.writeFile(JSON.stringify(metadata), 'utf8');
          await handle.close();
          return;
        } catch (e: any) {
          if (abortState.aborted) throw new Error(text.resource.lockAcquireHardTimeout(repoPath));
          if (e.code === 'EEXIST') {
            // Check if the lock is stale or the process is dead
            try {
              const fs = await import('fs/promises');
              const content = await fs.readFile(lockFile, 'utf8');
              const metadata: LockMetadata = JSON.parse(content);
              const isSelfLock =
                metadata.pid === process.pid && metadata.owner === this.currentOwner;

              const isAlive = this.isProcessAlive(metadata.pid);

              // Never auto-remove a lock owned by the current process.
              // If we did, concurrent calls within the same process could break mutual exclusion.
              if (!isSelfLock && !isAlive) {
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
            await this.abortableDelay(delay, hardAbort.signal);
          } else if (e.code === 'ENOENT') {
            // Directory might not exist, try to create it
            try {
              await mkdir(repoPath, { recursive: true });
              continue; // Retry immediately
            } catch {
              // If mkdir fails, just wait and retry
            }
            await this.abortableDelay(LIMITS.retry.io.initialDelayMs, hardAbort.signal);
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

        const isAlive = this.isProcessAlive(metadata.pid);

        // Only force remove if the owning process is not alive.
        if (!isSelfLock && !isAlive) {
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
    };

    let hardTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        core(),
        new Promise<never>((_, reject) => {
          hardTimer = setTimeout(() => {
            abortState.aborted = true;
            hardAbort.abort();
            onEvent?.({
              type: 'resource.status',
              resource: 'lock',
              status: 'warning',
              message: text.resource.lockAcquireHardTimeout(repoPath),
              timestamp: new Date(),
            });
            reject(new Error(text.resource.lockAcquireHardTimeout(repoPath)));
          }, hardTimeoutMs);
        }),
      ]);
    } catch (error) {
      // Release the in-process lock if we failed to acquire the file lock.
      this.releaseLocal(lockFile);
      throw error;
    } finally {
      if (hardTimer) clearTimeout(hardTimer);
    }
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
      // Verify ownership before releasing.
      try {
        const fs = await import('fs/promises');
        const content = await fs.readFile(lockFile, 'utf8');
        const metadata: LockMetadata = JSON.parse(content);
        if (metadata.owner !== this.currentOwner) {
          return; // Not the owner
        }
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code === 'ENOENT') return;
        onEvent?.({
          type: 'resource.status',
          resource: 'lock',
          status: 'warning',
          message: text.resource.lockReleaseOwnershipUnknown(
            repoPath,
            err?.message ? String(err.message) : String(error),
          ),
          timestamp: new Date(),
        });
        return;
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
    } finally {
      // Always release the in-process lock to avoid local deadlocks.
      this.releaseLocal(lockFile);
    }
  }
}
