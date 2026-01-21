import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join, basename, relative, normalize, isAbsolute } from 'path';
import { promisify } from 'util';
import { randomBytes } from 'crypto';

import { logger } from '../logger.js';
import { GitError } from '../types.js';
import { LIMITS } from '../limits.js';
import { monitor } from '../monitor.js';

export type CheckpointRef = {
  strategy: 'worktree';
  repoPath: string;
  worktreePath: string;
  baseRef: string;
  branchName: string;
};

/**
 * Creates a git worktree checkpoint for isolated execution.
 * @param repoPath - Path to the main git repository
 * @returns CheckpointRef object with worktree details
 */
export async function createWorktreeCheckpoint(repoPath: string): Promise<CheckpointRef> {
  try {
    // Validate that we're in a git repository
    const isGitRepo = await runGit(repoPath, ['rev-parse', '--is-inside-work-tree']);
    if (isGitRepo.trim() !== 'true') {
      throw new GitError('Not a git repository', 'git rev-parse');
    }

    // Get the current base reference (HEAD)
    const baseRef = await runGit(repoPath, ['rev-parse', 'HEAD']);

    // Generate a unique worktree path in temp directory
    const repoName = basename(repoPath);
    const timestamp = Date.now();
    const random = randomBytes(4).toString('hex'); // Use crypto secure random
    const worktreePath = join(tmpdir(), `salmon-loop-wt/${repoName}/${timestamp}-${random}`);

    // Path safety validation
    const tmpDir = normalize(tmpdir());
    const normalizedWorktreePath = normalize(worktreePath);
    if (!normalizedWorktreePath.startsWith(tmpDir)) {
      throw new Error("Worktree path must be in system temp directory");
    }
    // Check if worktree is inside repo (unsafe) - relative path should start with '..' if outside
    if (!relative(repoPath, worktreePath).startsWith("..")) {
      throw new Error("Worktree path must not be inside repo path");
    }

    // Generate a unique branch name for the worktree
    const branchName = `salmonloop/wt/${timestamp}-${random}`;

    // Create the worktree using git worktree add --detach
    // Using --detach avoids creating a branch that could pollute the repo
    await runGit(repoPath, ['worktree', 'add', '--detach', worktreePath, baseRef]);

    logger.debug(`Created worktree checkpoint: ${worktreePath} based on ${baseRef}`);
    
    // Record successful checkpoint creation
    monitor.recordCheckpointCreate(true);

    return {
      strategy: 'worktree',
      repoPath,
      worktreePath,
      baseRef,
      branchName,
    };
  } catch (error) {
    // Record failed checkpoint creation
    monitor.recordCheckpointCreate(false);
    throw error;
  }
}

/**
 * Cleans up a git worktree checkpoint.
 * @param ref - CheckpointRef object to clean up
 */
export async function cleanupWorktreeCheckpoint(ref: CheckpointRef): Promise<void> {
  const { worktreePath, branchName } = ref;
  let cleanupSuccess = true;

  try {
    // First verify worktree exists before attempting removal
    const worktreeList = await runGit(ref.repoPath, ['worktree', 'list', '--porcelain']);
    if (!worktreeList.includes(worktreePath)) {
      logger.warn(`Worktree not found in git worktree list: ${worktreePath}`);
      throw new Error("Worktree not found, skipping cleanup");
    }

    // Try to remove the worktree using git worktree remove --force
    await runGit(ref.repoPath, ['worktree', 'remove', '--force', worktreePath]);
    logger.debug(`Removed worktree checkpoint: ${worktreePath}`);
  } catch (error) {
    // If git worktree remove fails, fallback to direct filesystem removal
    // This is a safety net to ensure cleanup even if git command fails
    logger.warn(`git worktree remove failed for ${worktreePath}, falling back to filesystem removal`);
    try {
      // Ensure we're not accidentally deleting the main repo
      if (worktreePath === ref.repoPath) {
        throw new Error('Cannot delete main repository path');
      }
      
      // Additional safety check: ensure path is in temp directory
      const tmpDir = normalize(tmpdir());
      const normalizedWorktreePath = normalize(worktreePath);
      if (!normalizedWorktreePath.startsWith(tmpDir)) {
        throw new Error('Worktree path not in temp directory, refusing to delete');
      }
      
      // Use a more robust approach to delete the directory
      // This will handle read-only files and other edge cases
      await promisify(require('rimraf'))(worktreePath);
      logger.debug(`Successfully cleaned up worktree directory via rimraf: ${worktreePath}`);
    } catch (rimrafError) {
      logger.error(`Failed to cleanup worktree directory ${worktreePath}: ${rimrafError}`);
      cleanupSuccess = false;
      monitor.recordCheckpointCleanup(false);
      throw new Error(`Failed to cleanup worktree: ${rimrafError}`);
    }
  }

  // Try to delete the associated branch if it exists
  // This is best effort - ignore errors if branch doesn't exist
  try {
    await runGit(ref.repoPath, ['branch', '-D', branchName]);
    logger.debug(`Deleted worktree branch: ${branchName}`);
  } catch (error) {
    // Branch might not exist or could be in use - ignore this error
    logger.debug(`Failed to delete branch ${branchName}, it may not exist or is in use`);
  }
  
  // Record cleanup result
  if (cleanupSuccess) {
    monitor.recordCheckpointCleanup(true);
  }
}

/**
 * Helper function to run git commands with timeout and error handling
 * @param repoPath - Path to git repository
 * @param args - Git command arguments
 * @returns Promise with command output
 */
export async function runGit(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let output = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      reject(new GitError(`git command failed: ${err.message}`, 'git', stderr));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output.trim());
      } else {
        reject(new GitError(`git command failed with code ${code}: ${stderr}`, 'git', stderr));
      }
    });

    // Add timeout to prevent hanging
    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        reject(new GitError(`git command timed out after ${LIMITS.gitTimeoutMs}ms`, 'git', stderr));
      }
    }, LIMITS.gitTimeoutMs);
  });
}