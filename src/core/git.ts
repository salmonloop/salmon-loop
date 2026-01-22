import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { writeFile, unlink, open, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { text } from '../locales/index.js';

import { LIMITS } from './limits.js';
import { logger } from './logger.js';
import { GitError } from './types.js';

interface LockMetadata {
  pid: number;
  timestamp: number;
  owner: string;
}

/**
 * Manages file locks to prevent concurrent access to the same repository or files.
 */
class FileHandleManager {
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

const lockManager = new FileHandleManager();

const diffCache: Map<string, string | undefined> = new Map();

export function clearGitCache() {
  diffCache.clear();
}

export type RollbackResult = {
  ok: boolean;
  attempted: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export async function applyPatch(
  repoPath: string,
  diffText: string,
  options?: {
    preserveIndexLines?: boolean;
    contextLines?: number;
    ignoreWhitespace?: boolean;
    applyIndex?: boolean;
    cached?: boolean;
    threeWay?: boolean;
  },
): Promise<void> {
  logger.audit('applyPatch.start', { repoPath });
  await lockManager.acquireLock(repoPath);
  try {
    clearGitCache();
    // Preprocess diffText to remove index lines that might contain hallucinated hashes
    const cleanedDiff = options?.preserveIndexLines
      ? diffText
      : diffText
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith('index '))
          .join('\n');

    const tempFile = join(
      tmpdir(),
      `salmon-loop-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.patch`,
    );

    await writeFile(tempFile, cleanedDiff, 'utf8');

    try {
      await new Promise<void>((resolve, reject) => {
        const args = ['apply', '--recount'];
        if (typeof options?.contextLines === 'number') {
          args.push(`-C${options.contextLines}`);
        }
        if (options?.threeWay) {
          args.push('-3');
        }

        if (options?.ignoreWhitespace !== false) {
          args.push('--ignore-space-change', '--ignore-whitespace');
        }

        if (options?.cached) {
          args.push('--cached');
        } else if (options?.applyIndex) {
          args.push('--index');
        }

        args.push(tempFile);

        const child = spawn('git', args, { cwd: repoPath });

        let output = '';
        child.stdout?.on('data', (data) => (output += data.toString()));
        child.stderr?.on('data', (data) => (output += data.toString()));

        child.on('error', (err) => {
          reject(new GitError(text.git.applySpawnFailed(String(err)), 'git apply', String(err)));
        });

        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new GitError(text.git.applyFailed(output.trim()), 'git apply', output.trim()));
          }
        });
      });
    } finally {
      try {
        await unlink(tempFile);
      } catch (error) {
        logger.warn('Failed to cleanup temp file: ' + String(error));
      }
    }
  } finally {
    await lockManager.releaseLock(repoPath);
    logger.audit('applyPatch.end', { repoPath });
  }
}

async function resolveConflicts(repoPath: string): Promise<{ ok: boolean; error?: string }> {
  let lastError: string | undefined;

  // 1. git stash to clear index (may fail if nothing to stash, that's ok)
  await new Promise<void>((resolve) => {
    const child = spawn('git', ['stash'], { cwd: repoPath });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });

  // 2. git reset --hard HEAD - this MUST succeed
  const resetResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const child = spawn('git', ['reset', '--hard', 'HEAD'], { cwd: repoPath });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: `git reset --hard HEAD failed: ${stderr}` });
      }
    });
    child.on('error', (err) => {
      resolve({ ok: false, error: `git reset --hard HEAD spawn error: ${err}` });
    });
  });

  if (!resetResult.ok) {
    lastError = resetResult.error;
  }

  // 3. git clean -fd to remove untracked files (like .rej) - this MUST succeed
  const cleanResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const child = spawn('git', ['clean', '-fd'], { cwd: repoPath });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: `git clean -fd failed: ${stderr}` });
      }
    });
    child.on('error', (err) => {
      resolve({ ok: false, error: `git clean -fd spawn error: ${err}` });
    });
  });

  if (!cleanResult.ok) {
    lastError = lastError ? `${lastError}; ${cleanResult.error}` : cleanResult.error;
  }

  // 4. Verify workspace is clean
  const statusResult = await new Promise<string>((resolve) => {
    const child = spawn('git', ['status', '--porcelain'], {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d.toString()));
    child.on('close', () => resolve(output.trim()));
    child.on('error', () => resolve(''));
  });

  if (statusResult) {
    // Workspace still has changes - this is a real failure
    return {
      ok: false,
      error: lastError
        ? `${lastError}; Workspace still dirty: ${statusResult}`
        : `Workspace still dirty after cleanup: ${statusResult}`,
    };
  }

  return { ok: true };
}

export async function rollbackFiles(
  repoPath: string,
  files: string[],
  forceReset = false,
  ref?: string,
): Promise<RollbackResult> {
  logger.audit('rollbackFiles.start', { repoPath, files, forceReset });
  await lockManager.acquireLock(repoPath);
  try {
    clearGitCache();
    // Path safety: filter out absolute paths or parent directory references
    const safeFiles = files
      .map((f) => f.trim().replace(/\\/g, '/'))
      .filter((f) => {
        if (!f) return false;
        // No absolute paths (Unix or Windows)
        if (f.startsWith('/') || /^[a-zA-Z]:\//.test(f)) return false;
        // No path traversal
        if (f.includes('..')) return false;
        // No empty or whitespace-only paths (already handled by trim and !f)
        return true;
      });

    // Deduplicate
    const attempted = Array.from(new Set(safeFiles));

    if (attempted.length === 0 && !forceReset) {
      return { ok: true, attempted: [], exitCode: 0, stdout: '', stderr: '' };
    }

    return await new Promise((resolve) => {
      // If forceReset is true, execute git reset --hard <ref>
      // Otherwise, try to checkout specified files
      const args = forceReset
        ? ['reset', '--hard', ref || 'HEAD']
        : ['checkout', '--', ...attempted];

      if (forceReset) {
        logger.trace(`[rollbackFiles] Executing: git ${args.join(' ')} (ref=${ref})`);
      }

      const child = spawn('git', args, { cwd: repoPath });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));

      child.on('error', (err) => {
        resolve({
          ok: false,
          attempted,
          exitCode: null,
          stdout,
          stderr: (stderr ? stderr + '\n' : '') + String(err),
        });
      });

      child.on('close', async (code) => {
        if (code !== 0) {
          // If checkout failed, we must ensure the repo is clean.
          // We try resolveConflicts as a fallback to handle any git error or conflict state.
          const conflictResult = await resolveConflicts(repoPath);
          if (!conflictResult.ok) {
            // resolveConflicts failed - this is a real rollback failure
            resolve({
              ok: false,
              attempted,
              exitCode: code,
              stdout,
              stderr: stderr + '\n' + (conflictResult.error || 'resolveConflicts failed'),
            });
            return;
          }
          resolve({
            ok: true,
            attempted,
            exitCode: 0,
            stdout,
            stderr: stderr + '\nForced rollback via resolveConflicts due to git error',
          });
          return;
        }

        if (code === 0 && forceReset) {
          // If reset succeeded and forceReset is true, also perform git clean -fd
          try {
            await new Promise<void>((res, rej) => {
              const cleanChild = spawn('git', ['clean', '-fd'], { cwd: repoPath });
              cleanChild.on('close', (cleanCode) => (cleanCode === 0 ? res() : rej()));
              cleanChild.on('error', rej);
            });
          } catch (e) {
            // Log clean failure but don't necessarily fail the whole rollback
            stderr += `\nWarning: git clean -fd failed: ${String(e)}`;
          }
        }

        // Final verification: ensure workspace is actually clean
        const finalStatus = await new Promise<string>((res) => {
          const statusChild = spawn('git', ['status', '--porcelain'], {
            cwd: repoPath,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let output = '';
          statusChild.stdout.on('data', (d) => (output += d.toString()));
          statusChild.on('close', () => res(output.trim()));
          statusChild.on('error', () => res(''));
        });

        if (finalStatus) {
          // Workspace still dirty after rollback - try one more time with resolveConflicts
          const conflictResult = await resolveConflicts(repoPath);
          if (!conflictResult.ok) {
            resolve({
              ok: false,
              attempted,
              exitCode: code,
              stdout,
              stderr:
                stderr +
                `\nWorkspace still dirty after rollback: ${finalStatus}\n${conflictResult.error || ''}`,
            });
            return;
          }
        }

        resolve({
          ok: true,
          attempted,
          exitCode: code,
          stdout,
          stderr,
        });
      });
    });
  } finally {
    await lockManager.releaseLock(repoPath);
    logger.audit('rollbackFiles.end', { repoPath });
  }
}

export async function getGitDiff(
  repoPath: string,
  cached = false,
  file?: string,
): Promise<string | undefined> {
  const cacheKey = `${repoPath}:${cached}:${file || ''}`;
  if (diffCache.has(cacheKey)) {
    return diffCache.get(cacheKey);
  }

  return new Promise((resolve) => {
    const args = ['diff'];
    if (cached) args.push('--cached');
    if (file) args.push('--', file);

    const child = spawn('git', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoPath,
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      const result = code === 0 && output.trim() ? output : undefined;
      diffCache.set(cacheKey, result);
      resolve(result);
    });

    child.on('error', () => {
      resolve(undefined);
    });
  });
}

export async function getGitStatus(repoPath: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--short'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoPath,
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', () => {
      resolve(output.trim());
    });

    child.on('error', () => {
      resolve('');
    });
  });
}
