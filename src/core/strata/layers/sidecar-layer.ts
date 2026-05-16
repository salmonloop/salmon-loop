/**
 * SyntheticSidecarLayer - Layer 3 Ignored/Untracked File Handling
 *
 * Manages ignored and untracked files for ShadowMergeEngine
 * Provides base content for ignored files that are modified during execution.
 */

import { dirname } from 'path';

import { existsSync } from '../../adapters/fs/node-fs.js';
import { mkdir, readFile, writeFile as writeFileToDisk } from '../../adapters/fs/node-fs.js';
import { getLogger } from '../../observability/logger.js';
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
    getLogger().debug(`Capturing ${paths.length} ignored/untracked files`);

    for (const filePath of paths) {
      const normalized = normalizePath(filePath);
      if (!isSafeRelativePath(normalized)) {
        getLogger().warn(`Skipping unsafe path capture: ${filePath}`);
        continue;
      }

      try {
        const absolutePath = this.repoRoot ? safeJoin(this.repoRoot, normalized) : normalized;
        if (existsSync(absolutePath)) {
          const content = await readFile(absolutePath);
          this.capturedFiles.set(normalized, content);
          getLogger().debug(`Captured file: ${normalized}`);
        }
      } catch (error) {
        getLogger().warn(`Failed to capture file ${filePath}: ${error}`);
      }
    }
  }

  /**
   * Inject captured files to shadow worktree
   */
  async inject(shadowPath: string): Promise<void> {
    getLogger().debug(`Injecting ${this.capturedFiles.size} files to shadow worktree`);

    const entries = Array.from(this.capturedFiles.entries());
    const chunkSize = 10;

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(async ([filePath, content]) => {
          const shadowFilePath = safeJoin(shadowPath, filePath);

          try {
            await writeSidecarFile(shadowFilePath, content);
            getLogger().debug(`Injected file: ${filePath}`);
          } catch (error) {
            getLogger().warn(`Failed to inject file ${filePath}: ${error}`);
          }
        }),
      );
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
    getLogger().debug('Cleared all captured files');
  }
}

/**
 * Write file helper
 */
async function writeSidecarFile(filePath: string, content: Buffer): Promise<void> {
  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Write file
  await writeFileToDisk(filePath, content);
}
