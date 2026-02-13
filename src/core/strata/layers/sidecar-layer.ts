/**
 * SyntheticSidecarLayer - Layer 3 Ignored/Untracked File Handling
 *
 * Manages ignored and untracked files for ShadowMergeEngine
 * Provides base content for ignored files that are modified during execution.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';

import { logger } from '../../logger.js';
import { isSafeRelativePath, normalizePath, safeJoin } from '../../utils/path.js';
import type { SyntheticSidecarLayer } from '../types.js';

/**
 * SyntheticSidecarLayer Implementation
 */
export class SyntheticSidecarLayerImpl implements SyntheticSidecarLayer {
  private capturedFiles: Map<string, Buffer> = new Map();

  constructor(private repoRoot?: string) {}

  /**
   * Capture ignored/untracked files
   */
  async capture(paths: string[]): Promise<void> {
    logger.debug(`Capturing ${paths.length} ignored/untracked files`);

    for (const filePath of paths) {
      const normalized = normalizePath(filePath);
      if (!isSafeRelativePath(normalized)) {
        logger.warn(`Skipping unsafe path capture: ${filePath}`);
        continue;
      }

      try {
        const absolutePath = this.repoRoot ? safeJoin(this.repoRoot, normalized) : normalized;
        if (existsSync(absolutePath)) {
          const content = await readFile(absolutePath);
          this.capturedFiles.set(normalized, content);
          logger.debug(`Captured file: ${normalized}`);
        }
      } catch (error) {
        logger.warn(`Failed to capture file ${filePath}: ${error}`);
      }
    }
  }

  /**
   * Inject captured files to shadow worktree
   */
  async inject(shadowPath: string): Promise<void> {
    logger.debug(`Injecting ${this.capturedFiles.size} files to shadow worktree`);

    for (const [filePath, content] of this.capturedFiles) {
      const shadowFilePath = safeJoin(shadowPath, filePath);

      try {
        await writeFile(shadowFilePath, content);
        logger.debug(`Injected file: ${filePath}`);
      } catch (error) {
        logger.warn(`Failed to inject file ${filePath}: ${error}`);
      }
    }
  }

  /**
   * Check if file is captured
   */
  has(path: string): boolean {
    const normalized = normalizePath(path);
    if (!isSafeRelativePath(normalized)) return false;
    return this.capturedFiles.has(normalized);
  }

  /**
   * Get captured file content
   */
  async get(path: string): Promise<Buffer | null> {
    const normalized = normalizePath(path);
    if (!isSafeRelativePath(normalized)) return null;
    return this.capturedFiles.get(normalized) || null;
  }

  /**
   * Clear captured files
   */
  async clear(): Promise<void> {
    this.capturedFiles.clear();
    logger.debug('Cleared all captured files');
  }
}

/**
 * Write file helper
 */
async function writeFile(filePath: string, content: Buffer): Promise<void> {
  const { writeFile } = await import('fs/promises');
  const { dirname } = await import('path');
  const { mkdir } = await import('fs/promises');

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Write file
  await writeFile(filePath, content);
}
