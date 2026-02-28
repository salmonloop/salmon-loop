import { randomBytes } from 'crypto';
import { realpathSync } from 'fs';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { text } from '../../../locales/index.js';
import { LIMITS } from '../../config/limits.js';
import { logIgnoredError } from '../../observability/ignored-error.js';
import { logger } from '../../observability/logger.js';
import { GitError } from '../../types/index.js';
import { isPathWithinDirectory, normalizePath } from '../../utils/path.js';

import type { GitRunLimits, GitRunResult } from './git-runner.js';
import { runGitCommand } from './git-runner.js';
import { FileHandleManager } from './lock-manager.js';

// Singleton map to ensure one lock manager per repository path
const lockManagers = new Map<string, FileHandleManager>();

function getLockManager(repoPath: string): FileHandleManager {
  if (!lockManagers.has(repoPath)) {
    lockManagers.set(repoPath, new FileHandleManager());
  }
  return lockManagers.get(repoPath)!;
}

function isShaLike(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value);
}

function splitPathsByCharBudget(baseArgs: string[], paths: string[], maxChars: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];

  const baseLen = baseArgs.reduce((sum, a) => sum + a.length + 1, 0);
  let currentLen = baseLen;

  for (const p of paths) {
    const addLen = p.length + 1;
    if (current.length > 0 && currentLen + addLen > maxChars) {
      batches.push(current);
      current = [];
      currentLen = baseLen;
    }
    current.push(p);
    currentLen += addLen;
  }

  if (current.length > 0) batches.push(current);
  return batches;
}

function joinNulTerminated(values: string[]): Buffer {
  // Git pathspec-from-file expects elements separated by NUL when --pathspec-file-nul is set.
  return Buffer.from(values.join('\0') + '\0', 'utf8');
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
   * Low-level git execution that returns structured output without throwing.
   * Prefer higher-level helpers (`exec`, `query`) unless the caller must
   * inspect spawn errors (e.g., ENOENT) or truncation flags.
   */
  async execMeta(
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      input?: Buffer;
      timeoutMs?: number;
      limits?: GitRunLimits;
    } = {},
  ): Promise<GitRunResult> {
    return await runGitCommand({
      repoRoot: this.repoPath,
      args,
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      timeoutMs: options.timeoutMs ?? LIMITS.gitTimeoutMs,
      limits: options.limits,
    });
  }

  /**
   * Primary executor for Git commands.
   * Standardizes environment, timeout, and handles machine-readable output.
   */
  async exec(
    args: string[],
    options: {
      allowError?: boolean;
      cwd?: string;
      env?: Record<string, string>;
      input?: Buffer;
      limits?: GitRunLimits;
      timeoutMs?: number;
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
    options: {
      allowError?: boolean;
      cwd?: string;
      env?: Record<string, string>;
      input?: Buffer;
      limits?: GitRunLimits;
      timeoutMs?: number;
      allowTruncatedStdout?: boolean;
    } = {},
  ): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
    const res = await this.execMeta(args, {
      cwd: options.cwd,
      env: options.env,
      input: options.input,
      timeoutMs: options.timeoutMs,
      limits: options.limits,
    });

    if (res.stdoutTruncated && !options.allowTruncatedStdout) {
      const maxStdoutBytes = options.limits?.maxStdoutBytes;
      const safeMaxBytes =
        typeof maxStdoutBytes === 'number' && Number.isFinite(maxStdoutBytes)
          ? maxStdoutBytes
          : LIMITS.maxToolOutputBytes;
      throw new GitError(text.git.outputTruncated(safeMaxBytes), args.join(' '), res.stderr);
    }

    if (res.ok || options.allowError) {
      return { stdout: res.stdout, stderr: res.stderr, code: res.code };
    }

    if (res.timedOut) {
      throw new GitError(
        text.git.timeout(options.timeoutMs ?? LIMITS.gitTimeoutMs),
        args.join(' '),
        res.stderr,
      );
    }

    if (res.code === 128) {
      logger.debug(`[GitAdapter] Code 128 Debug: Args: ${args.join(' ')}\nStderr: ${res.stderr}`);
    }

    if (res.error?.message) {
      throw new GitError(text.git.processError(res.error.message), args.join(' '), res.stderr);
    }

    throw new GitError(text.git.commandFailed(res.code), args.join(' '), res.stderr);
  }

  /**
   * Execute validated Git commands with security validation.
   *
   * Note: Despite the historic name, this gateway is not strictly read-only.
   * It allows a small set of well-scoped plumbing commands used by the
   * execution model (e.g., worktree management and ref bookkeeping).
   */
  async query(
    args: string[],
    options: {
      allowError?: boolean;
      cwd?: string;
      env?: Record<string, string>;
      limits?: GitRunLimits;
      timeoutMs?: number;
      trim?: boolean;
    } = {},
  ): Promise<string> {
    this.assertQueryAllowed(args);
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
    if (!this.isShadowWorktreePath()) {
      throw new GitError(text.git.indexWriteDenied, 'updateIndex', 'Index Write Denied');
    }
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
    const base = ['status', '--porcelain=v2'];
    if (!paths || paths.length === 0) return this.exec(base);

    const safePaths = this.sanitizePaths(paths);
    if (safePaths.length === 0) return this.exec(base);

    const batches = splitPathsByCharBudget([...base, '--'], safePaths, LIMITS.gitArgMaxChars);
    const outputs: string[] = [];
    for (const batch of batches) {
      outputs.push(await this.exec([...base, '--', ...batch]));
    }
    return outputs.join('\n').replace(/\n+$/, '');
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
      const isBinary =
        /(^|\n)GIT binary patch(\r?\n|$)/.test(diffText) ||
        /(^|\n)(literal|delta) \d+(\r?\n|$)/.test(diffText) ||
        /(^|\n)Binary files .* differ(\r?\n|$)/.test(diffText);

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
        await fs
          .unlink(tempFile)
          .catch((error) => logIgnoredError(`[GitAdapter] cleanup ${tempFile}`, error));
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
      // CRITICAL SAFETY: Restores from Index to Worktree to preserve user's staged changes.
      const base = ['checkout'];
      if (ref) base.push(ref);
      const batches = splitPathsByCharBudget([...base, '--'], safePaths, LIMITS.gitArgMaxChars);
      if (batches.length <= 1) {
        await this.exec([...base, '--', ...safePaths]);
        return;
      }

      // Avoid ARG_MAX and reduce partial-rollback risk by using a single checkout invocation.
      const tempFile = path.join(
        tmpdir(),
        `salmon-pathspec-${Date.now()}-${randomBytes(4).toString('hex')}.txt`,
      );

      await fs.writeFile(tempFile, joinNulTerminated(safePaths));
      try {
        await this.exec([...base, '--pathspec-from-file', tempFile, '--pathspec-file-nul']);
      } catch (error) {
        // Fallback for older Git versions without pathspec-from-file support.
        const msg =
          error instanceof Error
            ? error instanceof Error
              ? error.message
              : String(error)
            : String(error);
        if (!/pathspec-from-file/i.test(msg)) throw error;
        for (const batch of batches) {
          await this.exec([...base, '--', ...batch]);
        }
      } finally {
        await fs
          .unlink(tempFile)
          .catch((error) => logIgnoredError(`[GitAdapter] cleanup ${tempFile}`, error));
      }
    } catch (error: unknown) {
      try {
        await this.resolveConflicts();
      } catch (cleanupError: unknown) {
        const cleanupMessage =
          cleanupError instanceof Error
            ? cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
            : String(cleanupError);
        const rollbackMessage =
          error instanceof Error
            ? error instanceof Error
              ? error.message
              : String(error)
            : String(error);
        throw new GitError(
          `${cleanupMessage}; original rollback error: ${rollbackMessage}`,
          'rollbackFiles',
          cleanupMessage,
        );
      }
      throw error;
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

  private assertQueryAllowed(args: string[]): void {
    const cmd = args[0];
    if (!cmd) throw new Error(text.git.securityViolation(String(cmd)));

    const allowed = new Set([
      'diff',
      'for-each-ref',
      'log',
      'ls-files',
      'ls-tree',
      'read-tree',
      'rev-parse',
      'show',
      'status',
      'update-index',
      'update-ref',
      'worktree',
      'write-tree',
    ]);

    if (!allowed.has(cmd)) throw new Error(text.git.securityViolation(cmd));

    if (cmd === 'diff') {
      if (args.includes('--no-index')) throw new Error(text.git.securityViolation(cmd));
    }

    if (cmd === 'write-tree') {
      if (args.length !== 1) throw new Error(text.git.securityViolation(cmd));
    }

    if (cmd === 'read-tree') {
      if (args.length !== 2 || !isShaLike(args[1])) {
        throw new Error(text.git.securityViolation(cmd));
      }
    }

    if (cmd === 'update-index') {
      const ok = args.length === 3 && args[1] === '-q' && args[2] === '--refresh';
      if (!ok) throw new Error(text.git.securityViolation(cmd));
    }

    if (cmd === 'update-ref') {
      const hasMessage = args.length === 5 && args[1] === '-m';
      if (!hasMessage) throw new Error(text.git.securityViolation(cmd));
      const refName = args[3];
      const newValue = args[4];
      if (!refName.startsWith('refs/s8p/')) throw new Error(text.git.securityViolation(cmd));
      if (!isShaLike(newValue)) throw new Error(text.git.securityViolation(cmd));
    }

    if (cmd === 'for-each-ref') {
      const refPrefix = args[args.length - 1];
      if (!refPrefix || !refPrefix.startsWith('refs/s8p/snapshots/')) {
        throw new Error(text.git.securityViolation(cmd));
      }

      const allowedPrefixes = ['--sort=', '--format=', '--count='];
      for (const token of args.slice(1, -1)) {
        if (!allowedPrefixes.some((p) => token.startsWith(p))) {
          throw new Error(text.git.securityViolation(cmd));
        }
      }
    }

    if (cmd === 'worktree') {
      const sub = args[1];
      const shadowRoot = GitAdapter.resolveShadowRoot();

      if (sub === 'list') {
        const ok = args.length === 3 && args[2] === '--porcelain';
        if (!ok) throw new Error(text.git.securityViolation(cmd));
        return;
      }

      if (sub === 'add') {
        const allowedFlags = new Set(['--quiet', '--detach']);
        const flags = new Set<string>();
        let i = 2;
        for (; i < args.length && args[i]?.startsWith('-'); i++) {
          const token = args[i]!;
          if (!allowedFlags.has(token)) throw new Error(text.git.securityViolation(cmd));
          flags.add(token);
        }

        if (!flags.has('--detach')) throw new Error(text.git.securityViolation(cmd));
        if (args.length - i !== 2) throw new Error(text.git.securityViolation(cmd));

        const worktreePath = path.resolve(args[i]!);
        const baseRef = args[i + 1]!;
        const parityRoot = GitAdapter.resolveParityShadowRoot(this.repoPath);
        const allowed = [shadowRoot, parityRoot].some((root) =>
          isPathWithinDirectory(root, worktreePath, { allowEqual: false }),
        );
        if (!allowed) {
          throw new Error(text.git.securityViolation(cmd));
        }
        if (!baseRef || baseRef.includes('..')) throw new Error(text.git.securityViolation(cmd));
        return;
      }

      if (sub === 'remove') {
        const allowedFlags = new Set(['--force']);
        const flags = new Set<string>();
        let i = 2;
        for (; i < args.length && args[i]?.startsWith('-'); i++) {
          const token = args[i]!;
          if (!allowedFlags.has(token)) throw new Error(text.git.securityViolation(cmd));
          flags.add(token);
        }

        if (!flags.has('--force')) throw new Error(text.git.securityViolation(cmd));
        if (args.length - i !== 1) throw new Error(text.git.securityViolation(cmd));

        const worktreePath = path.resolve(args[i]!);
        const parityRoot = GitAdapter.resolveParityShadowRoot(this.repoPath);
        const allowed = [shadowRoot, parityRoot].some((root) =>
          isPathWithinDirectory(root, worktreePath, { allowEqual: false }),
        );
        if (!allowed) {
          throw new Error(text.git.securityViolation(cmd));
        }
        return;
      }

      throw new Error(text.git.securityViolation(cmd));
    }
  }

  /**
   * Resolves the canonical path to the shadow worktree root directory.
   *
   * SECURITY: This method implements DOUBLE realpath resolution to prevent attacks:
   * 1. Prevents symlink attacks: Even if tmpdir() is a symlink, we resolve to the real path
   * 2. Prevents TMPDIR pollution: Attackers cannot trick the system by manipulating TMPDIR env var
   *
   * Why this matters:
   * - Shadow worktrees are the ONLY safe place for destructive operations (reset --hard, clean -fd)
   * - If an attacker could bypass this check, they could trigger data loss in the main repository
   * - Using realpathSync ensures we compare canonical paths, not attacker-controlled symlinks
   *
   * @returns Canonical shadow root path (e.g., "/tmp/s8p-wt")
   */
  private static resolveShadowRoot(): string {
    const tmpResolved = path.resolve(tmpdir());
    let tmpReal = tmpResolved;
    try {
      // CRITICAL: Resolve symlinks in tmpdir() itself
      // Example: /tmp -> /private/tmp on macOS
      tmpReal = realpathSync(tmpResolved);
    } catch {
      // Fall back to resolved path. If tmp is not realpath-resolvable, prefer denying shadow checks elsewhere.
      tmpReal = tmpResolved;
    }
    return path.join(tmpReal, 's8p-wt');
  }

  private static resolveParityShadowRoot(repoPath: string): string {
    const repoResolved = path.resolve(repoPath);
    let repoReal = repoResolved;
    try {
      repoReal = realpathSync(repoResolved);
    } catch {
      repoReal = repoResolved;
    }
    const parent = path.dirname(repoReal);
    return path.join(parent, '.salmonloop', 'worktrees');
  }

  /**
   * Verifies if the current GitAdapter instance points to a shadow worktree.
   *
   * SECURITY: Multi-layer defense against path traversal and symlink attacks:
   * 1. Both shadowRoot AND repoPath are resolved via realpathSync
   * 2. Directory-aware containment check prevents partial matches (e.g., /tmp/s8p-wt-evil)
   * 3. String prefix pitfalls are avoided by path.relative semantics
   *
   * Why this check is CRITICAL:
   * - Operations like resolveConflicts() execute `git reset --hard HEAD` and `git clean -fd`
   * - These commands PERMANENTLY DELETE uncommitted changes and untracked files
   * - This check ensures such operations ONLY run in disposable shadow worktrees
   * - The main repository is NEVER touched by destructive cleanup operations
   *
   * Attack scenarios prevented:
   * - Symlink injection: realpathSync resolves links before comparison
   * - Path traversal: strict prefix check prevents escape via ../
   * - Partial path matching: trailing separator prevents /tmp/s8p-wt-malicious from matching
   *
   * @returns true if this.repoPath is inside the shadow worktree root, false otherwise
   */
  private isShadowWorktreePath(): boolean {
    const expectedRoot = GitAdapter.resolveShadowRoot();
    const repoResolved = path.resolve(this.repoPath);
    let repo = repoResolved;
    try {
      // CRITICAL: Resolve symlinks in the repo path being checked
      // Prevents attacker from creating a symlink to main repo inside shadow root
      repo = realpathSync(repoResolved);
    } catch {
      repo = repoResolved;
    }
    return isPathWithinDirectory(expectedRoot, repo, { allowEqual: false });
  }

  /**
   * Aggressively cleans the shadow worktree to resolve merge conflicts or corrupted state.
   *
   * ⚠️ DANGER: This method runs DESTRUCTIVE Git operations:
   * - `git reset --hard HEAD`: Discards ALL uncommitted changes
   * - `git clean -fd`: Deletes ALL untracked files and directories
   *
   * WHY THIS IS SAFE (not a data loss risk):
   * 1. Protected by isShadowWorktreePath() check - throws error if not in shadow
   * 2. Shadow worktrees are DISPOSABLE temporary directories (e.g., /tmp/s8p-wt/...)
   * 3. User's main repository is NEVER touched - it remains in read-only state
   * 4. Original state is preserved in snapshot commits (refs/s8p/snapshots/*)
   * 5. Apply-back process is transactional - failures don't corrupt main workspace
   *
   * Design Intent (see docs/design/checkpoint.md):
   * - "AI modifications run in a disposable 'Shadow Worktree', never polluting
   *    the user's primary workspace until verified"
   *
   * Common Misunderstanding:
   * ❌ "reset --hard will lose user data"
   * ✅ Correct: It only affects the temporary shadow, which is recreated from snapshots
   *
   * Error Handling:
   * - allowError: true on stash - may have nothing to stash, that's fine
   * - Catch block ignores errors - this is best-effort cleanup in a disposable environment
   * - Even if cleanup fails, shadow worktree is deleted during teardown anyway
   *
   * @throws GitError if called on main repository (safety violation)
   */
  private async resolveConflicts(): Promise<void> {
    // SAFETY BARRIER: Absolutely refuse to run destructive operations outside shadow
    if (!this.isShadowWorktreePath()) {
      throw new GitError(
        text.git.conflictResolutionDenied,
        'resolveConflicts',
        'Safety Check Failed',
      );
    }
    try {
      // Best-effort cleanup sequence for disposable shadow worktree
      await this.exec(['stash'], { allowError: true });
      await this.exec(['reset', '--hard', 'HEAD']);
      await this.exec(['clean', '-fd']);
    } catch (_e) {
      // Best-effort cleanup, ignore errors
      // Rationale: Shadow worktree will be deleted during teardown anyway
      // Logging errors here would just create noise for expected edge cases
    }
  }
}
