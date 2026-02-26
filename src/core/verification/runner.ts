import { join } from 'path';

import { text } from '../../locales/index.js';
import { readFile } from '../adapters/fs/node-fs.js';
import { GitAdapter } from '../adapters/git/git-adapter.js';
import { LIMITS } from '../config/limits.js';
import { logger } from '../observability/logger.js';
import { pluginRegistry } from '../plugin/registry.js';
import { isCommandAvailable, spawnCommand } from '../runtime/process-runner.js';
import { ErrorType, LoopEvent } from '../types/index.js';
import type { ExecutionWorkspace } from '../types/index.js';
import { getPlatformShellInvocation } from '../utils/platform-shell.js';

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

  // 1.5 Test failure strong signals (language agnostic)
  if (
    lowerOutput.includes('bun file tests failed in:') ||
    lowerOutput.includes('script "test:unit" exited with code') ||
    lowerOutput.includes('script "test:full" exited with code') ||
    lowerOutput.includes('test suites') ||
    lowerOutput.includes('test files') ||
    lowerOutput.includes('assertionerror')
  ) {
    return ErrorType.TEST;
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
  const shell = getPlatformShellInvocation(command);
  let output = '';
  const appendOutput = (chunk: Uint8Array) => {
    if (output.length >= 500000) return;
    const textChunk = Buffer.from(chunk).toString();
    const remaining = 500000 - output.length;
    output += textChunk.slice(0, remaining);
  };

  const result = await spawnCommand({
    command: shell.file,
    args: shell.args,
    cwd: repoPath,
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
    timeoutMs,
    killGraceMs: 2000,
    onStdoutChunk: appendOutput,
    onStderrChunk: appendOutput,
  });

  if (result.error) {
    return {
      ok: false,
      output: text.verify.commandError(command, result.error.message),
      exitCode: -1,
    };
  }

  if (result.timedOut) {
    output += text.verify.terminated;
  }

  const fullOutput = output.trim();
  const lines = fullOutput.split('\n');

  let truncatedOutput = fullOutput;
  if (lines.length > LIMITS.verifyOutputMaxLines) {
    const half = Math.floor(LIMITS.verifyOutputMaxLines / 2);
    const head = lines.slice(0, half).join('\n');
    const tail = lines.slice(-half).join('\n');
    truncatedOutput = `${head}${text.verify.outputTruncated(half, half)}${tail}`;
  }

  return {
    ok: !result.timedOut && result.code === 0,
    output: truncatedOutput,
    exitCode: result.code,
  };
}

export async function runVerify(
  repoPath: string,
  verifyCommand: string,
  env?: Record<string, string>,
): Promise<VerifyResult> {
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

export interface VerifyResult {
  ok: boolean;
  output: string;
  exitCode: number | null;
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
  } catch (err: unknown) {
    if (
      (err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined) === 'ENOENT'
    ) {
      return false;
    }
    // Report unexpected errors via event instead of direct logger.warn
    onEvent?.({
      type: 'resource.status',
      resource: 'file',
      status: 'warning',
      message: text.verify.verifyFileContentError(
        filePath,
        err instanceof Error ? err.message : String(err),
      ),
      timestamp: new Date(),
    });
    logger.debug(
      `verifyFileContent failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

export async function preflight(
  workspace: ExecutionWorkspace,
  onEvent?: (event: LoopEvent) => void,
  options?: { ignoreDirty?: boolean },
): Promise<{
  ok: boolean;
  reason?: string;
  reasonCode?: 'PREFLIGHT_DIRTY' | 'PREFLIGHT_NOT_GIT' | 'LOOP_FAILED';
}> {
  const now = () => new Date();
  const git = new GitAdapter(workspace.baseRepoPath);

  // 1. Check if it's a git repo
  const gitCheck = await git.execMeta(['rev-parse', '--is-inside-work-tree'], {
    cwd: workspace.baseRepoPath,
    limits: { maxStdoutBytes: 4_096, maxStderrChars: 4_096 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!gitCheck.ok) {
    if (gitCheck.error?.code === 'ENOENT') {
      return { ok: false, reason: text.loop.gitNotFound, reasonCode: 'PREFLIGHT_NOT_GIT' };
    }
    if (gitCheck.error?.message) {
      return {
        ok: false,
        reason: text.loop.preflightGitCheckFailed(gitCheck.error.message),
        reasonCode: 'PREFLIGHT_NOT_GIT',
      };
    }
    return { ok: false, reason: text.loop.preflightFailedNotGit, reasonCode: 'PREFLIGHT_NOT_GIT' };
  }
  if (gitCheck.stdoutTruncated) {
    return {
      ok: false,
      reason: text.loop.preflightGitCheckFailed(text.git.outputTruncated(4096)),
      reasonCode: 'LOOP_FAILED',
    };
  }

  // 2. Check if workspace is dirty (only for direct strategy)
  // Allow dirty workspace by default for worktree strategy
  if (workspace.strategy === 'direct' && !options?.ignoreDirty) {
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
        reasonCode: 'LOOP_FAILED',
      };
    }
    if (statusCheck.stdoutTruncated) {
      return {
        ok: false,
        reason: text.loop.preflightGitStatusFailed(text.git.outputTruncated(64_000)),
        reasonCode: 'LOOP_FAILED',
      };
    }

    const output = statusCheck.stdout.toString('utf8').trim();
    if (output.length > 0) {
      return {
        ok: false,
        reason: text.loop.preflightFailedDirty(output),
        reasonCode: 'PREFLIGHT_DIRTY',
      };
    }
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
  if (!(await isCommandAvailable('rg'))) {
    onEvent?.({
      type: 'resource.status',
      resource: 'ripgrep',
      status: 'warning',
      message: text.verify.ripgrepNotFoundWarning,
      timestamp: now(),
    });
  }

  return { ok: true };
}
