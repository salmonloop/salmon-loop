import { promises as fs, type Dirent, Stats } from 'fs';
import * as path from 'path';

import { AtomicFileWriter } from './atomic-file-writer.js';

/**
 * Unified file system adapter for all file operations.
 * Provides both atomic and non-atomic operations with consistent error handling.
 */
export class FileAdapter {
  private atomicWriter = new AtomicFileWriter();

  /**
   * Read file (non-atomic, for configuration/session files)
   */
  async readFile(filePath: string, encoding: BufferEncoding = 'utf-8'): Promise<string> {
    return fs.readFile(filePath, encoding);
  }

  /**
   * Write file (non-atomic, for application data)
   * Use this for session files, configs, logs where atomicity is not required
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Write file atomically (for user code modifications)
   * Use this when modifying user's source code
   */
  async writeFileAtomic(filePath: string, content: Buffer): Promise<void> {
    return this.atomicWriter.writeAtomic(filePath, content);
  }

  /**
   * Append to file (non-atomic, for logs)
   */
  async appendFile(filePath: string, content: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(filePath, content, 'utf-8');
  }

  /**
   * Check if file exists
   */
  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve real path (follows symlinks).
   */
  async realpath(filePath: string): Promise<string> {
    return fs.realpath(filePath);
  }

  /**
   * Read directory
   */
  async readdir(dirPath: string): Promise<string[]> {
    return fs.readdir(dirPath);
  }

  /**
   * Read directory entries with file type metadata.
   */
  async readdirWithTypes(dirPath: string): Promise<Dirent[]> {
    return fs.readdir(dirPath, { withFileTypes: true });
  }

  /**
   * Get file stats
   */
  async stat(filePath: string): Promise<Stats> {
    return fs.stat(filePath);
  }

  /**
   * Create directory recursively
   */
  async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * Delete file atomically (with retries)
   */
  async deleteFile(filePath: string): Promise<void> {
    return this.atomicWriter.deleteAtomic(filePath);
  }
}
