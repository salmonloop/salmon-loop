import { promises as fs } from 'fs';
import * as path from 'path';

import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { logger } from '../../logger.js';
import { ensureInSandbox } from '../../path.js';
import type { IFileSystemProvider } from '../types.js';

import { StrataContentGuardian } from './content-guardian.js';

/**
 * Strata File System Provider
 *
 * Implements the "Disk First" strategy for reading file content.
 * 🛡️ SAFETY NOTE: All physical IO is protected by Sandbox checks to
 * prevent unintended path traversal.
 */
export class StrataFileSystemProvider implements IFileSystemProvider {
  private readonly guardian: StrataContentGuardian;

  constructor(private readonly gitAdapter: GitAdapter) {
    this.guardian = new StrataContentGuardian();
  }

  /**
   * Reads the "Yours" version of a file.
   */
  async readYours(repoPath: string, relativePath: string): Promise<Buffer | null> {
    // 🛡️ Guard: Ensure we don't leak files outside the targeted repository
    const fullPath = ensureInSandbox(repoPath, path.join(repoPath, relativePath));

    try {
      logger.debug(`[StrataFileSystem] Reading 'Yours' content from disk: ${relativePath}`);
      return await fs.readFile(fullPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        logger.debug(`[StrataFileSystem] File not found on disk: ${relativePath}`);
        return null;
      }
      throw error;
    }
  }

  /**
   * Reads a file as Buffer safely within a controlled root.
   */
  async readFileBufferSafe(filePath: string, rootContext?: string): Promise<Buffer | null> {
    try {
      const safePath = rootContext ? ensureInSandbox(rootContext, filePath) : filePath;
      return await fs.readFile(safePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') return null;
      throw error;
    }
  }

  /**
   * Writes content to a file with sandbox enforcement.
   */
  async writeFile(filePath: string, content: Buffer | string, rootContext?: string): Promise<void> {
    const safePath = rootContext ? ensureInSandbox(rootContext, filePath) : filePath;
    await fs.writeFile(safePath, content);
  }

  /**
   * Creates a directory recursively with sandbox enforcement.
   */
  async mkdir(
    dirPath: string,
    options?: { recursive?: boolean },
    rootContext?: string,
  ): Promise<void> {
    const safePath = rootContext ? ensureInSandbox(rootContext, dirPath) : dirPath;
    await fs.mkdir(safePath, options);
  }

  /**
   * Deletes a file with sandbox enforcement.
   */
  async unlink(filePath: string, rootContext?: string): Promise<void> {
    const safePath = rootContext ? ensureInSandbox(rootContext, filePath) : filePath;
    await fs.unlink(safePath);
  }

  /**
   * Checks if a file is binary with optional sandbox enforcement.
   */
  async isBinary(filePath: string, rootContext?: string): Promise<boolean> {
    try {
      const safePath = rootContext ? ensureInSandbox(rootContext, filePath) : filePath;
      const buffer = await fs.readFile(safePath);
      return this.guardian.inspect(buffer).isBinary;
    } catch {
      return false;
    }
  }
}
