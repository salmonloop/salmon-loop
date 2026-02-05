import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

import { text } from '../locales/index.js';

import { GitAdapter } from './adapters/git/git-adapter.js';
import { LIMITS } from './limits.js';
import { logger } from './logger.js';
import { pluginRegistry } from './plugin/registry.js';
import { ErrorType, LoopEvent } from './types.js';
import type { ExecutionWorkspace } from './types.js';

/**
 * Classify the error type based on the output of the verification command
 */
export function classifyError(output: string): ErrorType {
  // 1. Common system errors (Language agnostic)
  const lowerOutput = output.toLowerCase();

  if (
    lowerOutput.includes('resource lock error') ||
    lowerOutput.includes('file lock') ||
    (lowerOutput.includes('already exists') && lowerOutput.includes('.lock')) ||
    lowerOutput.includes('ebusy') ||
    lowerOutput.includes('eperm')
  ) {
    return ErrorType.RESOURCE_LOCK_ERROR;
  }

  if (
    lowerOutput.includes('ast syntax error') ||
    lowerOutput.includes('ast structure error') ||
    lowerOutput.includes('ast scope integrity error') ||
    lowerOutput.includes('ast validation failed')
  ) {
    return ErrorType.AST_VALIDATION_ERROR;
  }

  // 2. Delegate to plugins
  for (const plugin of pluginRegistry.getAll()) {
    const errorType = plugin.diagnostics.classifyError(output);
    if (errorType) {
      return errorType;
    }
  }

  // 3. Generic logic fallback
  if (output.trim().length > 0) {
    return ErrorType.LOGIC;
  }

  return ErrorType.UNKNOWN;
}

/**
 * Determine if an error type is retryable
 */
export function isRetryable(error: ErrorType): boolean {
  switch (error) {
    case ErrorType.COMPILATION:
    case ErrorType.LINT:
    case ErrorType.TEST:
    case ErrorType.LOGIC:
    case ErrorType.AST_VALIDATION_ERROR:
      return true;
    case ErrorType.DEPENDENCY_ERROR:
    case ErrorType.RESOURCE_LOCK_ERROR:
    case ErrorType.UNKNOWN:
    default:
      return false;
  }
}

export async function runCommand(
  repoPath: string,
  command: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<{
  ok: boolean;
  output: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      cwd: repoPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: env ? { ...process.env, ...env } : process.env,
    });

    let output = '';
    let isTerminated = false;

    const timer = setTimeout(() => {
      isTerminated = true;
      // Try graceful termination first
      child.kill('SIGTERM');

      // Force kill after a short delay if still running
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (__e) {
          // Ignore
        }
      }, 2000);

      output += text.verify.terminated;
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      if (output.length < 500000) output += data.toString();
    });
    child.stderr?.on('data', (data) => {
      if (output.length < 500000) output += data.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        output: text.verify.commandError(command, String(err)),
        exitCode: -1,
      });
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const fullOutput = output.trim();
      const lines = fullOutput.split('\n');

      let truncatedOutput = fullOutput;
      if (lines.length > LIMITS.verifyOutputMaxLines) {
        const half = Math.floor(LIMITS.verifyOutputMaxLines / 2);
        const head = lines.slice(0, half).join('\n');
        const tail = lines.slice(-half).join('\n');
        truncatedOutput = `${head}${text.verify.outputTruncated(half, half)}${tail}`;
      }

      resolve({
        ok: !isTerminated && exitCode === 0,
        output: truncatedOutput,
        exitCode: exitCode,
      });
    });
  });
}

export async function runVerify(
  repoPath: string,
  verifyCommand: string,
  env?: Record<string, string>,
): Promise<{
  ok: boolean;
  output: string;
  exitCode: number | null;
}> {
  const result = await runCommand(repoPath, verifyCommand, LIMITS.verifyTimeoutMs, env);
  if (!result.ok && result.output.includes('Command timed out')) {
    result.output = result.output.replace('Command timed out', text.verify.commandTimeout);
  }
  if (!result.ok && result.output.includes('Failed to start command')) {
    result.output = result.output.replace(
      'Failed to start command',
      text.verify.failedToStartCommand,
    );
  }
  return result;
}

/**
 * Verify if a file contains the expected content (string or regex).
 *
 * @param repoPath - The root path of the repository
 * @param filePath - The relative path of the file to check
 * @param expected - The content string or regex to look for
 * @returns true if the content is found, false otherwise (including if file is missing)
 */
export async function verifyFileContent(
  repoPath: string,
  filePath: string,
  expected: string | RegExp,
  onEvent?: (event: LoopEvent) => void,
): Promise<boolean> {
  try {
    const fullPath = join(repoPath, filePath);
    const content = await readFile(fullPath, 'utf-8');

    if (typeof expected === 'string') {
      return content.includes(expected);
    } else {
      return expected.test(content);
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return false;
    }
    // Report unexpected errors via event instead of direct logger.warn
    onEvent?.({
      type: 'resource.status',
      resource: 'file',
      status: 'warning',
      message: text.verify.verifyFileContentError(filePath, err.message),
      timestamp: new Date(),
    });
    logger.debug(`verifyFileContent failed for ${filePath}: ${err.message}`);
    return false;
  }
}

export async function preflight(
  workspace: ExecutionWorkspace,
  onEvent?: (event: LoopEvent) => void,
): Promise<{ ok: boolean; reason?: string }> {
  const now = () => new Date();
  const git = new GitAdapter(workspace.baseRepoPath);

  // 1. Check if it's a git repo
  const gitCheck = await git.execMeta(['rev-parse', '--is-inside-work-tree'], {
    cwd: workspace.baseRepoPath,
    limits: { maxStdoutBytes: 4_096, maxStderrChars: 4_096 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!gitCheck.ok) {
    if (gitCheck.error?.code === 'ENOENT') return { ok: false, reason: text.loop.gitNotFound };
    if (gitCheck.error?.message) {
      return { ok: false, reason: text.loop.preflightGitCheckFailed(gitCheck.error.message) };
    }
    return { ok: false, reason: text.loop.preflightFailedNotGit };
  }
  if (gitCheck.stdoutTruncated) {
    return { ok: false, reason: text.loop.preflightGitCheckFailed(text.git.outputTruncated(4096)) };
  }

  // 2. Check if workspace is dirty (only for direct strategy)
  // Allow dirty workspace by default for worktree strategy
  if (workspace.strategy === 'direct') {
    const statusCheck = await git.execMeta(['status', '--porcelain'], {
      cwd: workspace.baseRepoPath,
      limits: { maxStdoutBytes: 64_000, maxStderrChars: 4_096 },
      timeoutMs: LIMITS.gitTimeoutMs,
    });

    if (!statusCheck.ok) {
      return {
        ok: false,
        reason: text.loop.preflightGitStatusFailed(
          statusCheck.error?.message ?? statusCheck.stderr.trim() ?? 'Unknown error',
        ),
      };
    }
    if (statusCheck.stdoutTruncated) {
      return {
        ok: false,
        reason: text.loop.preflightGitStatusFailed(text.git.outputTruncated(64_000)),
      };
    }

    const output = statusCheck.stdout.toString('utf8').trim();
    if (output.length > 0) return { ok: false, reason: text.loop.preflightFailedDirty(output) };
    return { ok: true };
  }

  // Worktree strategy: ignore dirty state in base repository
  onEvent?.({
    type: 'resource.status',
    resource: 'git',
    status: 'skipped',
    message: text.verify.worktreeStrategyActive,
    timestamp: now(),
  });

  // 3. Check if ripgrep is installed (optional but recommended)
  const rgCheck = spawn('rg', ['--version']);
  rgCheck.on('error', (err: any) => {
    if (err.code === 'ENOENT') {
      onEvent?.({
        type: 'resource.status',
        resource: 'ripgrep',
        status: 'warning',
        message: text.verify.ripgrepNotFoundWarning,
        timestamp: now(),
      });
    }
  });

  return { ok: true };
}
