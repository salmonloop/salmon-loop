import { promises as fs } from 'fs';
import { Buffer } from 'node:buffer';
import * as path from 'path';

import { LIMITS } from '../../limits.js';

/**
 * AtomicFileWriter
 * Handles secure, atomic file writes with retries for platform compatibility.
 */
export class AtomicFileWriter {
  private retryConfig = {
    maxAttempts: LIMITS.retry.io.maxAttempts,
    baseDelay: LIMITS.retry.io.initialDelayMs,
    maxDelay: LIMITS.retry.io.maxDelayMs,
    backoffMultiplier: 2,
  };

  /**
   * Write content atomically to a file.
   * 1. Check for symlinks (Safety).
   * 2. Write to temp file.
   * 3. Rename temp file to target (Atomic).
   */
  async writeAtomic(filePath: string, content: Buffer): Promise<void> {
    // filePath is expected to be absolute or relative to CWD.
    // Given the new absolutePath in FileState, the caller (TransactionStrategy)
    // passes context.file.path. We should probably verify what path is passed.
    // TransactionStrategy passes `this.ctx.file.path`.
    // We should probably update TransactionStrategy to pass `this.ctx.file.absolutePath`?
    // Or AtomicFileWriter assumes it gets a path it can write to.
    // If it receives relative path, it writes relative to CWD.
    // It's safer to use absolute path everywhere.

    // 1. Safety check
    await this.ensureNoSymlink(filePath);

    // 2. Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // 3. Write to temp file
    const tempPath = await this.writeToTemp(filePath, content);

    // 4. Atomic Rename with Retry
    await this.atomicRename(tempPath, filePath);
  }

  /**
   * Delete file atomically (with retries).
   */
  async deleteAtomic(filePath: string): Promise<void> {
    // 1. Safety check (ensure we are not deleting a symlink that points elsewhere?
    // Actually we probably want to delete the symlink itself if it is one.)
    // But ensureNoSymlink throws if it is a symlink.
    // If the intent is to delete the file at path, and it is a symlink, we delete the link.
    // If it's a directory, we fail (this is file writer).

    await this.retryWithBackoff(async () => {
      try {
        await fs.unlink(filePath);
      } catch (error: any) {
        if (error.code === 'ENOENT') return; // Already gone
        if (error.code === 'EBUSY' || error.code === 'EPERM') {
          throw error; // Trigger retry
        }
        throw error;
      }
    });
  }

  /**
   * Ensure target path is not a symlink to prevent TOCTOU attacks.
   */
  private async ensureNoSymlink(filePath: string): Promise<void> {
    try {
      const stats = await fs.lstat(filePath);
      if (stats.isSymbolicLink()) {
        throw new Error(`Refusing to write to symbolic link: ${filePath}`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private async writeToTemp(targetPath: string, content: Buffer): Promise<string> {
    const tempPath = `${targetPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;
    await fs.writeFile(tempPath, content, { mode: 0o644, flag: 'w' });
    return tempPath;
  }

  private async atomicRename(tempPath: string, targetPath: string): Promise<void> {
    await this.retryWithBackoff(async () => {
      try {
        await fs.rename(tempPath, targetPath);
      } catch (error: any) {
        if (error.code === 'EBUSY' || error.code === 'EPERM') {
          throw error;
        }
        throw new Error(`Atomic rename failed: ${error.message} (${tempPath} -> ${targetPath})`);
      }
    });
  }

  private async retryWithBackoff(fn: () => Promise<void>): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retryConfig.maxAttempts; attempt++) {
      try {
        await fn();
        return;
      } catch (error: any) {
        lastError = error;
        if (attempt === this.retryConfig.maxAttempts - 1) break;

        const delay = Math.min(
          this.retryConfig.baseDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt),
          this.retryConfig.maxDelay,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError!;
  }
}
