import { spawn } from 'child_process';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { LIMITS } from '../../limits.js';
import { logger } from '../../logger.js';
import { normalizePath } from '../../path.js';
import { GitError } from '../../types.js';

import { FileHandleManager } from './lock-manager.js';

// Singleton map to ensure one lock manager per repository path
const lockManagers = new Map<string, FileHandleManager>();

function getLockManager(repoPath: string): FileHandleManager {
  if (!lockManagers.has(repoPath)) {
    lockManagers.set(repoPath, new FileHandleManager());
  }
  return lockManagers.get(repoPath)!;
}

/**
 * PathStatus: Represents the physical state of a file in the repository.
 */
export interface PathStatus {
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  deleted: boolean;
}

/**
 * GitAdapter: The unified security gateway for Git interactions.
 * This is the EXCLUSIVE outlet for all Git commands in the system.
 */
export class GitAdapter {
  private lockManager: FileHandleManager;

  constructor(public readonly repoPath: string) {
    this.lockManager = getLockManager(repoPath);
  }

  // ==================== Base Execution Layer ====================

  /**
   * Primary executor for Git commands.
   * Standardizes environment, timeout, and handles machine-readable output.
   */
  async exec(
    args: string[],
    options: {
      allowError?: boolean;
      env?: Record<string, string>;
      input?: Buffer;
      trim?: boolean;
    } = {},
  ): Promise<string> {
    const res = await this.execRaw(args, options);
    const output = res.stdout.toString('utf8');
    return options.trim === false ? output : output.replace(/\s+$/, '');
  }

  /**
   * Raw executor for Git commands that returns Buffers.
   * Internal use only to support binary data and stdin.
   */
  private async execRaw(
    args: string[],
    options: { allowError?: boolean; env?: Record<string, string>; input?: Buffer } = {},
  ): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
    const env = {
      ...process.env,
      LC_ALL: 'C',
      GIT_OPTIONAL_LOCKS: '0',
      ...(options.env || {}),
    };

    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.repoPath,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const stdoutChunks: Buffer[] = [];
      let stderr = '';

      child.stdout?.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
      child.stderr?.on('data', (data) => (stderr += data.toString()));

      child.on('error', (err) => {
        if (options.allowError) {
          return resolve({ stdout: Buffer.alloc(0), stderr: err.message, code: -1 });
        }
        reject(new GitError(`Git process error: ${err.message}`, args.join(' '), stderr));
      });

      child.on('close', (code) => {
        const stdout = Buffer.concat(stdoutChunks);
        if (code === 0 || options.allowError) {
          resolve({ stdout, stderr, code });
        } else {
          // Debugging code 128
          if (code === 128) {
            logger.debug(`[GitAdapter] Code 128 Debug: Args: ${args.join(' ')}\nStderr: ${stderr}`);
          }
          reject(new GitError(`Git command failed with code ${code}`, args.join(' '), stderr));
        }
      });

      if (options.input) {
        child.stdin?.write(options.input);
        child.stdin?.end();
      }

      setTimeout(() => {
        if (child && !child.killed && typeof child.kill === 'function') {
          child.kill();
          reject(
            new GitError(
              `Git command timed out after ${LIMITS.gitTimeoutMs}ms`,
              args.join(' '),
              stderr,
            ),
          );
        }
      }, LIMITS.gitTimeoutMs);
    });
  }

  /**
   * Execute read-only query commands with security validation.
   */
  async query(
    args: string[],
    options: { allowError?: boolean; trim?: boolean } = {},
  ): Promise<string> {
    const forbidden = [
      'add',
      'commit',
      'clean',
      'reset',
      'checkout',
      'merge',
      'push',
      'pull',
      'apply',
    ];
    if (forbidden.includes(args[0])) {
      throw new Error(`Security Violation: Command '${args[0]}' is not a query.`);
    }
    return this.exec(args, options);
  }

  // ==================== Business Layer ====================

  /**
   * Generates a blob hash for the given content without writing to the object database.
   * Useful for comparing content against git objects.
   */
  async hashObject(content: Buffer): Promise<string> {
    const res = await this.execRaw(['hash-object', '--stdin'], { input: content });
    return res.stdout.toString('utf8').trim();
  }

  /**
   * Updates the index with the given content.
   * Uses plumbing commands (hash-object -w + update-index) to avoid touching the working tree.
   */
  async updateIndex(mode: string, hash: string, relativePath: string): Promise<void> {
    await this.exec(['update-index', '--cacheinfo', mode, hash, relativePath]);
  }

  /**
   * Check if a path is ignored by .gitignore rules.
   * Uses check-ignore plumbing command.
   */
  async checkIgnore(relativePath: string): Promise<boolean> {
    const res = await this.execRaw(['check-ignore', '-q', '--no-index', relativePath], {
      allowError: true,
    });
    return res.code === 0;
  }

  async getStatus(paths?: string[]): Promise<string> {
    const args = ['status', '--porcelain=v2'];
    if (paths && paths.length > 0) args.push('--', ...paths);
    return this.exec(args);
  }

  /**
   * Get the status of a specific path.
   * Uses git status --porcelain -z -- [path] to handle special characters in filenames.
   *
   * @param relativePath - The relative path to check
   * @returns PathStatus object or null if path is not tracked
   */
  async getStatusForPath(relativePath: string): Promise<PathStatus | null> {
    const res = await this.execRaw(['status', '--porcelain', '-z', '--', relativePath], {
      allowError: true,
    });

    // If no output, path is not tracked
    if (!res.stdout || res.stdout.length === 0) {
      return null;
    }

    const status = res.stdout.toString('utf8');
    const tokens = status.split('\0').filter((token: string) => token.length > 0);

    if (tokens.length === 0) {
      return null;
    }

    // Parse the status codes
    let staged = false;
    let unstaged = false;
    let untracked = false;
    let deleted = false;

    for (let i = 0; i < tokens.length; i += 1) {
      const entry = tokens[i];
      const code = entry.slice(0, 2);

      // Handle rename/copy entries
      if (code.startsWith('R') || code.startsWith('C')) {
        // In -z format, renames are: XY PATH1\0PATH2\0
        // entry (tokens[i]) is "XY PATH1", tokens[i+1] is "PATH2"
        const originalPath = entry.slice(3);
        const newPath = tokens[i + 1];

        // Check if this rename/copy affects our target path
        if (originalPath && normalizePath(originalPath) === normalizePath(relativePath)) {
          // Original path matches - this is the "from" side of rename
          const x = code[0]; // Index status
          const y = code[1]; // Working tree status

          staged = staged || (x !== ' ' && x !== '?');
          unstaged = unstaged || y !== ' ';
          deleted = deleted || x === 'D' || y === 'D';
        }
        if (newPath && normalizePath(newPath) === normalizePath(relativePath)) {
          // New path matches - this is the "to" side of rename
          const x = code[0]; // Index status
          const y = code[1]; // Working tree status

          staged = staged || (x !== ' ' && x !== '?');
          unstaged = unstaged || y !== ' ';
          // For the "to" side, it's not deleted (it's the new location)
        }
        i += 1;
        continue;
      }

      // Extract path from entry
      let pathPart = '';
      if (entry.length > 2) {
        const maybeSep = entry[2];
        if (maybeSep === ' ' || maybeSep === '\t') {
          pathPart = entry.slice(3);
        } else {
          pathPart = entry.slice(2);
        }
      }

      if (pathPart && normalizePath(pathPart) === normalizePath(relativePath)) {
        // Correct parsing logic according to Git porcelain format
        const x = code[0]; // Index status
        const y = code[1]; // Working tree status

        // Staged: X is not space or question mark
        staged = staged || (x !== ' ' && x !== '?');

        // Unstaged: Y is not space
        unstaged = unstaged || y !== ' ';

        // Untracked: both X and Y are question marks
        untracked = untracked || (x === '?' && y === '?');

        // Deleted: X or Y contains 'D'
        deleted = deleted || x === 'D' || y === 'D';
      }
    }

    return { staged, unstaged, untracked, deleted };
  }

  /**
   * Read file content as Buffer to handle binary data safely.
   */
  async show(revision: string, filePath: string): Promise<Buffer> {
    const res = await this.execRaw(['show', `${revision}:${filePath}`]);
    return res.stdout;
  }

  /**
   * Perform a three-way merge on files using git merge-file.
   */
  async mergeFile(
    basePath: string,
    currentPath: string,
    incomingPath: string,
    options: { union?: boolean } = {},
  ): Promise<{ content: Buffer; hasConflict: boolean }> {
    const args = ['merge-file', '-p', '-q'];
    if (options.union) args.push('--union');
    args.push(currentPath, basePath, incomingPath);
    const res = await this.execRaw(args, { allowError: true });
    // git merge-file exit codes:
    //   0: success, no conflicts
    //   1: success, conflicts present (markers in output)
    //   other: error (invalid inputs, unreadable files, etc.)
    // We must treat any non-(0|1) code as a hard failure; otherwise callers may write empty output to disk.
    if (res.code !== 0 && res.code !== 1) {
      throw new GitError('git merge-file failed', args.join(' '), res.stderr);
    }
    return {
      content: res.stdout,
      hasConflict: res.code === 1,
    };
  }

  async applyPatch(diffText: string, options: any = {}): Promise<void> {
    await this.lockManager.acquireLock(this.repoPath);
    try {
      // NOTE:
      // - `git apply -3` requires valid preimage blob ids (from `index <old>..<new>` lines).
      // - LLM-generated diffs often contain fake index lines, which triggers:
      //   "repository lacks the necessary blob to perform 3-way merge."
      // - For safety, we dynamically decide whether 3-way is possible:
      //   - If all referenced old blobs exist, keep index lines and run -3.
      //   - Otherwise, strip index lines and fall back to non-3-way apply.
      //
      // FIX: Do not strip index lines if patch is binary, as it corrupts the binary payload.
      const isBinary = diffText.includes('GIT binary patch');

      const extractOldBlobIds = (text: string): string[] => {
        const ids = new Set<string>();
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const m = line.match(/^\s*index\s+([0-9a-f]{7,40})\.\.[0-9a-f]{7,40}(?:\s+\d+)?\s*$/i);
          if (m?.[1]) ids.add(m[1]);
        }
        return Array.from(ids);
      };

      const blobExists = async (sha: string): Promise<boolean> => {
        // `git cat-file -e <sha>` exits 0 if the object exists.
        const res = await this.execRaw(['cat-file', '-e', sha], { allowError: true });
        return res.code === 0;
      };

      let useThreeWay = Boolean(options.threeWay);
      let preserveIndexLines = Boolean(options.preserveIndexLines) || isBinary;

      if (useThreeWay && !preserveIndexLines) {
        const oldIds = extractOldBlobIds(diffText).filter((id) => !/^0+$/.test(id));
        if (oldIds.length === 0) {
          // No index lines means -3 is not possible; fall back to direct apply.
          useThreeWay = false;
        } else {
          for (const id of oldIds) {
            const exists = await blobExists(id);
            if (!exists) {
              useThreeWay = false;
              break;
            }
          }
          // Only preserve index lines if we can actually do 3-way.
          preserveIndexLines = useThreeWay;
        }
      }

      let cleanedDiff = diffText;
      if (!preserveIndexLines) {
        cleanedDiff = diffText
          .split(/\r?\n/)
          .filter((l: string) => {
            const trimmedStart = l.trimStart();
            const lower = trimmedStart.toLowerCase();
            return !(lower.startsWith('index ') || lower.startsWith('index\t'));
          })
          .join('\n');
      }

      const tempFile = path.join(
        tmpdir(),
        `salmon-patch-${Date.now()}-${randomBytes(4).toString('hex')}.patch`,
      );
      await fs.writeFile(tempFile, cleanedDiff, 'utf8');

      try {
        const args = ['apply', '--recount'];
        if (useThreeWay) args.push('-3');
        if (options.ignoreWhitespace) args.push('--ignore-whitespace');
        if (options.contextLines) args.push(`-C${options.contextLines}`);
        args.push(tempFile);
        await this.exec(args, { env: options.env });
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
    } finally {
      await this.lockManager.releaseLock(this.repoPath);
    }
  }

  /**
   * Precision rollback protecting staged changes.
   */
  async rollbackFiles(paths: string[], ref?: string): Promise<void> {
    const safePaths = this.sanitizePaths(paths);
    if (safePaths.length === 0) return;

    await this.lockManager.acquireLock(this.repoPath);
    try {
      const args = ['checkout'];
      if (ref) args.push(ref);
      args.push('--', ...safePaths);
      await this.exec(args);
    } catch (_error: any) {
      await this.resolveConflicts();
    } finally {
      await this.lockManager.releaseLock(this.repoPath);
    }
  }

  /**
   * Compatibility alias for rollbackFiles.
   * If paths is a string (legacy call), it treats it as a single file rollback or handles it gracefully.
   */
  async safeRollback(paths: string[] | string, ref?: string): Promise<void> {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    return this.rollbackFiles(pathArray, ref);
  }

  private sanitizePaths(paths: string[]): string[] {
    return paths
      .map((p) => p.trim().replace(/\\/g, '/'))
      .filter((p) => p && !p.startsWith('/') && !p.includes('..'));
  }

  private async resolveConflicts(): Promise<void> {
    try {
      await this.exec(['stash'], { allowError: true });
      await this.exec(['reset', '--hard', 'HEAD']);
      await this.exec(['clean', '-fd']);
    } catch (_e) {
      // Best-effort cleanup, ignore errors
    }
  }
}
