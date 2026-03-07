/**
 * Real Filesystem Test Helper
 *
 * Provides utilities for integration tests that use REAL file systems
 * instead of mocks, following the "source is truth" principle.
 *
 * Key Features:
 * - Automatic temp directory creation and cleanup
 * - Real Git repository initialization
 * - File content management
 * - Automatic cleanup on test completion
 *
 * @example
 * ```typescript
 * import { RealFsTestHelper } from '../helpers/real-fs-helper.js';
 *
 * describe('Integration Test', () => {
 *   const helper = new RealFsTestHelper();
 *
 *   afterEach(async () => {
 *     await helper.cleanup();
 *   });
 *
 *   it('should work with real files', async () => {
 *     const repo = await helper.createGitRepo();
 *     await helper.writeFile(repo.path, 'test.txt', 'content');
 *     // ... test with real filesystem
 *   });
 * });
 * ```
 */

import { spawn } from 'child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import { tryGetLogger } from '../../src/core/observability/logger.js';

export interface GitRepoInfo {
  /** Absolute path to the repository */
  path: string;
  /** Initial commit hash */
  initialCommit?: string;
}

export interface FileEntry {
  /** Relative path from repo root */
  path: string;
  /** File content */
  content: string | Buffer;
}

/**
 * Executes a command and returns the output
 */
async function execCommand(
  cwd: string,
  command: string,
  args: string[],
  options: { trim?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      // shell: false is generally safer and more predictable across platforms
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });
    }

    // Wait for both the process to exit and streams to close
    child.on('error', reject);

    child.on('close', (code) => {
      resolve({
        stdout: options.trim === false ? stdout : stdout.trim(),
        stderr: options.trim === false ? stderr : stderr.trim(),
        exitCode: code ?? 0,
      });
    });
  });
}

/**
 * Real Filesystem Test Helper
 *
 * Manages temporary directories and real Git repositories for integration tests.
 */
export class RealFsTestHelper {
  private createdPaths: string[] = [];

  // Note: Logger and Monitor are initialized by tests/setup-bun.ts via --preload
  // Production code should use tryGetLogger()/tryGetMonitor() for test compatibility

  /**
   * Creates a temporary directory with a unique name
   *
   * @param prefix - Optional prefix for the directory name
   * @returns Absolute path to the created directory
   */
  async createTempDir(prefix = 'salmon-test-'): Promise<string> {
    const tempPath = await mkdtemp(path.join(tmpdir(), prefix));
    this.createdPaths.push(tempPath);
    return tempPath;
  }

  /**
   * Creates a real Git repository with initial setup
   *
   * @param options - Configuration options
   * @returns Repository information including path and initial commit
   */
  async createGitRepo(options?: {
    /** Directory name prefix */
    prefix?: string;
    /** Initial files to create */
    initialFiles?: FileEntry[];
    /** Whether to create an initial commit */
    createInitialCommit?: boolean;
    /** Git config overrides */
    gitConfig?: Record<string, string>;
  }): Promise<GitRepoInfo> {
    const {
      prefix = 'git-repo-',
      initialFiles = [],
      createInitialCommit = true,
      gitConfig = {},
    } = options ?? {};

    const repoPath = await this.createTempDir(prefix);

    // Initialize Git repository
    // Retry git init a few times as it can be flaky on Windows CI/overloaded systems
    let initAttempts = 0;
    while (initAttempts < 5) {
      try {
        // Use --initial-branch=main to be consistent and avoid 'master' vs 'main' issues
        const init = await execCommand(repoPath, 'git', ['init', '--initial-branch=main']);
        if (init.exitCode === 0) {
          // Verify .git exists to be absolutely sure
          if (await this.fileExists(repoPath, '.git')) {
            // Further verification: check if we can run a git command
            const status = await execCommand(repoPath, 'git', [
              'rev-parse',
              '--is-inside-work-tree',
            ]);
            if (status.exitCode === 0 && status.stdout === 'true') {
              break;
            }
          }
        }
        tryGetLogger()?.trace(`git init attempt ${initAttempts + 1} failed or unverified.`);
      } catch (e) {
        tryGetLogger()?.trace(`git init attempt ${initAttempts + 1} threw error: ${e}`);
      }

      initAttempts++;
      if (initAttempts === 5) {
        throw new Error(`git init failed after 5 attempts`);
      }
      // Wait for file system to settle, especially on Windows
      await new Promise((r) => setTimeout(r, 100));
    }

    // Configure Git
    await execCommand(repoPath, 'git', ['config', 'user.name', 'Test User']);
    await execCommand(repoPath, 'git', ['config', 'user.email', 'test@example.com']);

    // Apply custom config
    for (const [key, value] of Object.entries(gitConfig)) {
      await execCommand(repoPath, 'git', ['config', key, value]);
    }

    let initialCommit: string | undefined;

    if (createInitialCommit) {
      // Create initial files
      if (initialFiles.length === 0) {
        // Create a default README if no files specified
        await this.writeFile(repoPath, 'README.md', '# Test Repository\n');
      } else {
        for (const file of initialFiles) {
          await this.writeFile(repoPath, file.path, file.content);
        }
      }

      // Create initial commit
      const add = await execCommand(repoPath, 'git', ['add', '-A']);
      if (add.exitCode !== 0) throw new Error(`git add failed: ${add.stderr}`);

      const commit = await execCommand(repoPath, 'git', ['commit', '-m', 'Initial commit']);
      if (commit.exitCode !== 0) throw new Error(`git commit failed: ${commit.stderr}`);

      // Get commit hash
      const { stdout, exitCode, stderr } = await execCommand(repoPath, 'git', [
        'rev-parse',
        'HEAD',
      ]);
      if (exitCode !== 0) throw new Error(`git rev-parse HEAD failed: ${stderr}`);
      initialCommit = stdout.trim();
    }

    return {
      path: repoPath,
      initialCommit,
    };
  }

  /**
   * Writes a file to the specified path
   *
   * @param basePath - Base directory path
   * @param relativePath - Relative path from base
   * @param content - File content
   */
  async writeFile(basePath: string, relativePath: string, content: string | Buffer): Promise<void> {
    const fullPath = path.join(basePath, relativePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    // Write file - use appropriate encoding based on content type
    if (content instanceof Buffer) {
      await writeFile(fullPath, content);
    } else {
      await writeFile(fullPath, content, 'utf-8');
    }
  }

  /**
   * Reads a file from the specified path
   *
   * @param basePath - Base directory path
   * @param relativePath - Relative path from base
   * @returns File content
   */
  async readFile(
    basePath: string,
    relativePath: string,
    encoding?: 'utf-8' | null,
  ): Promise<string | Buffer> {
    const fullPath = path.join(basePath, relativePath);
    if (encoding === null) {
      return readFile(fullPath);
    }
    return readFile(fullPath, encoding || 'utf-8');
  }

  /**
   * Checks if a file exists
   *
   * @param basePath - Base directory path
   * @param relativePath - Relative path from base
   * @returns true if file exists
   */
  async fileExists(basePath: string, relativePath: string): Promise<boolean> {
    try {
      const fullPath = path.join(basePath, relativePath);
      await stat(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates a commit in the repository
   *
   * @param repoPath - Repository path
   * @param message - Commit message
   * @param files - Files to stage (empty array = stage all)
   * @returns Commit hash
   */
  async createCommit(repoPath: string, message: string, files: string[] = []): Promise<string> {
    if (files.length === 0) {
      await execCommand(repoPath, 'git', ['add', '-A']);
    } else {
      await execCommand(repoPath, 'git', ['add', ...files]);
    }

    await execCommand(repoPath, 'git', ['commit', '-m', message]);

    const { stdout } = await execCommand(repoPath, 'git', ['rev-parse', 'HEAD']);
    return stdout.trim();
  }

  /**
   * Gets the current Git status
   *
   * @param repoPath - Repository path
   * @returns Git status output
   */
  async getGitStatus(repoPath: string): Promise<string> {
    const { stdout } = await execCommand(repoPath, 'git', ['status', '--short']);
    return stdout;
  }

  /**
   * Gets the Git diff
   *
   * @param repoPath - Repository path
   * @param staged - Whether to get staged diff
   * @returns Git diff output
   */
  async getGitDiff(repoPath: string, staged = false): Promise<string> {
    const args = staged ? ['diff', '--cached'] : ['diff'];
    const { stdout } = await execCommand(repoPath, 'git', args);
    return stdout;
  }

  /**
   * Modifies a file and optionally stages it
   *
   * @param repoPath - Repository path
   * @param relativePath - File path relative to repo
   * @param content - New content
   * @param stage - Whether to stage the change
   */
  async modifyFile(
    repoPath: string,
    relativePath: string,
    content: string | Buffer,
    stage = false,
  ): Promise<void> {
    await this.writeFile(repoPath, relativePath, content);

    if (stage) {
      await execCommand(repoPath, 'git', ['add', relativePath]);
    }
  }

  /**
   * Creates a dirty workspace with uncommitted changes
   *
   * @param repoPath - Repository path
   * @param changes - Files to modify
   * @returns Status of the dirty workspace
   */
  async createDirtyWorkspace(
    repoPath: string,
    changes: FileEntry[],
  ): Promise<{ status: string; files: string[] }> {
    const modifiedFiles: string[] = [];

    for (const change of changes) {
      await this.modifyFile(repoPath, change.path, change.content);
      modifiedFiles.push(change.path);
    }

    const status = await this.getGitStatus(repoPath);

    return {
      status,
      files: modifiedFiles,
    };
  }

  /**
   * Executes a Git command
   *
   * @param repoPath - Repository path
   * @param args - Git command arguments
   * @returns Command output
   */
  async git(
    repoPath: string,
    args: string[],
    options?: { trim?: boolean },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return execCommand(repoPath, 'git', args, options);
  }

  /**
   * Executes any command in the repository
   *
   * @param repoPath - Repository path
   * @param command - Command to execute
   * @param args - Command arguments
   * @returns Command output
   */
  async exec(
    repoPath: string,
    command: string,
    args: string[] = [],
    options?: { trim?: boolean },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return execCommand(repoPath, command, args, options);
  }

  /**
   * Creates a worktree for the repository
   *
   * @param repoPath - Main repository path
   * @param worktreePath - Path for the worktree (if not provided, creates in temp)
   * @param branch - Branch name for the worktree
   * @returns Worktree path
   */
  async createWorktree(
    repoPath: string,
    worktreePath?: string,
    branch = 'test-worktree',
  ): Promise<string> {
    const wtPath = worktreePath ?? (await this.createTempDir('worktree-'));

    await execCommand(repoPath, 'git', ['worktree', 'add', '--quiet', '-b', branch, wtPath]);

    return wtPath;
  }

  /**
   * Removes a worktree
   *
   * @param repoPath - Main repository path
   * @param worktreePath - Worktree path to remove
   */
  async removeWorktree(repoPath: string, worktreePath: string): Promise<void> {
    await execCommand(repoPath, 'git', ['worktree', 'remove', '--force', worktreePath]);
  }

  /**
   * Cleans up all created temporary directories
   *
   * Should be called in afterEach or afterAll hooks.
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    for (const dirPath of this.createdPaths) {
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        try {
          await rm(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
          break; // Success
        } catch (error) {
          attempts++;
          if (attempts === maxAttempts) {
            errors.push(error instanceof Error ? error : new Error(String(error)));
          } else {
            // Exponential backoff for EBUSY
            await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, attempts)));
          }
        }
      }
    }

    this.createdPaths = [];

    if (errors.length > 0) {
      tryGetLogger()?.warn(
        `Failed to cleanup ${errors.length} directories: ${errors.map((e) => e.message).join(', ')}`,
      );
    }
  }

  /**
   * Gets the number of created paths (for debugging)
   */
  getCreatedPathsCount(): number {
    return this.createdPaths.length;
  }
}

/**
 * Helper function to create a simple test repository with common structure
 *
 * @param helper - RealFsTestHelper instance
 * @param lang - Programming language ('ts', 'js', 'py', etc.)
 * @returns Repository info with created file paths
 */
export async function createSimpleProject(
  helper: RealFsTestHelper,
  lang: 'ts' | 'js' | 'py' = 'ts',
): Promise<GitRepoInfo & { files: Record<string, string> }> {
  const templates = {
    ts: {
      'src/index.ts': 'export function hello() {\n  return "Hello, World!";\n}\n',
      'src/utils.ts': 'export function add(a: number, b: number) {\n  return a + b;\n}\n',
      'package.json': JSON.stringify(
        {
          name: 'test-project',
          version: '1.0.0',
          type: 'module',
        },
        null,
        2,
      ),
      'tsconfig.json': JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'node',
          },
        },
        null,
        2,
      ),
    },
    js: {
      'src/index.js': 'export function hello() {\n  return "Hello, World!";\n}\n',
      'src/utils.js': 'export function add(a, b) {\n  return a + b;\n}\n',
      'package.json': JSON.stringify(
        {
          name: 'test-project',
          version: '1.0.0',
          type: 'module',
        },
        null,
        2,
      ),
    },
    py: {
      'src/main.py': 'def hello():\n    return "Hello, World!"\n',
      'src/utils.py': 'def add(a, b):\n    return a + b\n',
      'requirements.txt': '',
    },
  };

  const files = templates[lang];
  const fileEntries: FileEntry[] = Object.entries(files).map(([path, content]) => ({
    path,
    content,
  }));

  const repo = await helper.createGitRepo({
    prefix: `${lang}-project-`,
    initialFiles: fileEntries,
  });

  return {
    ...repo,
    files: Object.fromEntries(Object.keys(files).map((p) => [p, path.join(repo.path, p)])),
  };
}
