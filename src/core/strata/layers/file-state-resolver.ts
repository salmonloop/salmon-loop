import { Buffer } from 'node:buffer';
import * as path from 'path';

import * as fs from '../../adapters/fs/node-fs.js';
import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { FileState, FileStatus } from '../../grizzco/domain/grizzco-types.js';
import { processInBatches } from '../../utils/batch.js';

/**
 * FileStateResolver
 * Responsibilities: Accurately scan workspace and index state, implementing the data foundation for Zero Index Access.
 */
export class FileStateResolver {
  constructor(
    private git: GitAdapter,
    private workspaceRoot: string,
  ) {}

  /**
   * Resolve the state of a single file.
   * Strictly follows git status --porcelain=v2 specification.
   */
  async resolve(filePath: string): Promise<FileState> {
    // Normalize path to forward slashes for Git
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Get status using GitAdapter
    const output = await this.git.getStatus([normalizedPath]);
    const line = output.trim().split('\n')[0] || '';
    const status = this.parseStatus(line);

    const absolutePath = path.join(this.workspaceRoot, normalizedPath);

    const state: FileState = {
      path: normalizedPath,
      absolutePath: absolutePath,
      status: status,
      isBinary: await this.detectBinary(absolutePath),
      isSymlink: await this.detectSymlink(absolutePath),
      isIgnored: await this.git.checkIgnore(normalizedPath), // [Added] Physical check for safety guard
      size: await this.getFileSize(absolutePath),
    };

    // For MM state, we need snapshots of both versions
    // stagedContent comes from Index (:0)
    // workingContent comes from Disk
    if (status === FileStatus.MM) {
      try {
        state.stagedContent = await this.git.show(':0', normalizedPath);
        state.workingContent = await fs.readFile(absolutePath);
      } catch {
        // Fallback: If we can't capture content, we might be in a race condition.
        // But proceed with what we have; strategy layer will handle missing content if needed.
      }
    }

    return state;
  }

  /**
   * Batch resolution
   */
  async getWorkspaceMap(paths: string[]): Promise<Map<string, FileState>> {
    const resultMap = new Map<string, FileState>();

    if (paths.length === 0) return resultMap;

    // Batch process files to prevent EMFILE exhaustion
    await processInBatches(paths, 10, async (p) => {
      const state = await this.resolve(p);
      resultMap.set(p, state);
    });

    return resultMap;
  }

  /**
   * Parse Git Porcelain V2 status line.
   * Format examples:
   * 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>  (Tracked)
   * ? <path>                                      (Untracked)
   * u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path> (Conflict)
   */
  private parseStatus(line: string): FileStatus {
    if (!line) return FileStatus.CLEAN;

    const parts = line.split(' ');
    const type = parts[0];

    // 1. Untracked
    if (type === '?') return FileStatus.UNTRACKED;

    // 2. Conflict (Unmerged)
    if (type === 'u') return FileStatus.CONFLICT;

    // 3. Tracked (Normal or Rename)
    if (type === '1' || type === '2') {
      const xy = parts[1]; // XY flags
      const x = xy[0];
      const y = xy[1];

      // Double Dirty (MM)
      // X (Index status) != Unmodified (.) AND Y (Worktree status) != Unmodified (.)
      if (x !== '.' && y !== '.') return FileStatus.MM;

      // Staged (X != '.', Y == '.')
      if (x !== '.' && y === '.') {
        if (x === 'A') return FileStatus.STAGED_ADDED;
        if (x === 'D') return FileStatus.STAGED_DELETED;
        return FileStatus.STAGED_MODIFIED;
      }

      // Unstaged (X == '.', Y != '.')
      if (x === '.' && y !== '.') {
        if (y === 'D') return FileStatus.UNSTAGED_DELETED;
        return FileStatus.UNSTAGED_MODIFIED;
      }
    }

    return FileStatus.CLEAN;
  }

  /**
   * Detect if a file is binary by checking for null bytes in the first 8KB.
   */
  private async detectBinary(filePath: string): Promise<boolean> {
    try {
      const buffer = Buffer.alloc(LIMITS.binaryCheckBufferSize);
      const fd = await fs.open(filePath, 'r');
      try {
        const { bytesRead } = await fd.read(buffer, 0, LIMITS.binaryCheckBufferSize, 0);
        const sample = buffer.subarray(0, bytesRead);
        return sample.includes(0x00);
      } finally {
        await fd.close();
      }
    } catch {
      // If file doesn't exist or can't be read, assume non-binary (safe default for new files)
      return false;
    }
  }

  /**
   * Detect if path is a symlink.
   */
  private async detectSymlink(filePath: string): Promise<boolean> {
    try {
      const stats = await fs.lstat(filePath);
      return stats.isSymbolicLink();
    } catch {
      return false;
    }
  }

  /**
   * Get file size in bytes.
   */
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }
}
