import { join } from 'path';

import { text } from '../../locales/index.js';
import { readFile } from '../adapters/fs/node-fs.js';
import { GitAdapter } from '../adapters/git/git-adapter.js';
import { LIMITS } from '../config/limits.js';
import { getLogger } from '../observability/logger.js';
import { tryGetPluginRegistry } from '../plugin/registry.js';
import { isCommandAvailable, spawnCommand } from '../runtime/process-runner.js';
import { ErrorType, LoopEvent } from '../types/index.js';
import type { ExecutionWorkspace } from '../types/index.js';
import { getPlatformShellInvocation } from '../utils/platform-shell.js';
import { detectWorkspaceCapabilities } from '../workspace/capabilities.js';

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
    lowerOutput.startsWith('fail ') ||
    lowerOutput.includes('\nfail ') ||
    lowerOutput.includes('test suites') ||
    lowerOutput.includes('test files') ||
    lowerOutput.includes('assertionerror')
  ) {
    return ErrorType.TEST;
  }

  // 2. Delegate to plugins
  for (const plugin of tryGetPluginRegistry()?.getAll() ?? []) {
    const errorType = plugin.diagnostics.classifyError(output);
    if (errorType) {
      return errorType;
    }
  }

  // 3. Heuristics fallback (works even without plugins)
  if (
    /TS\d{3,5}/i.test(output) ||
    lowerOutput.includes('error ts') ||
    lowerOutput.includes('failed to compile')
  ) {
    return ErrorType.COMPILATION;
  }

  if (
    lowerOutput.includes('eslint') ||
    lowerOutput.includes('prettier') ||
    lowerOutput.includes('prettier/prettier') ||
    lowerOutput.includes('oxfmt') ||
    lowerOutput.includes('format issues found') ||
    lowerOutput.includes('script "format:check" exited with code')
  ) {
    return ErrorType.LINT;
  }

  if (
    lowerOutput.includes('fail ') ||
    lowerOutput.includes('test suites') ||
    lowerOutput.includes('test files') ||
    lowerOutput.includes('assertionerror')
  ) {
    return ErrorType.TEST;
  }

  // 4. Generic logic fallback
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
  signal?: AbortSignal,
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
    detached: process.platform !== 'win32',
    env: env ? { ...process.env, ...env } : process.env,
    timeoutMs,
    killGraceMs: 2000,
    signal,
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
  signal?: AbortSignal,
): Promise<VerifyResult> {
  const result = await runCommand(repoPath, verifyCommand, LIMITS.verifyTimeoutMs, env, signal);
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
    // Report unexpected errors via event instead of direct getLogger().warn
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
    getLogger().debug(
      `verifyFileContent failed for ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

export async function preflight(
  workspace: ExecutionWorkspace,
  onEvent?: (event: LoopEvent) => void,
  options?: { ignoreDirty?: boolean; requireGit?: boolean; requireWrite?: boolean },
): Promise<{
  ok: boolean;
  reason?: string;
  reasonCode?: 'PREFLIGHT_DIRTY' | 'PREFLIGHT_NOT_GIT' | 'LOOP_FAILED';
  capabilities?: ExecutionWorkspace['capabilities'];
}> {
  const now = () => new Date();
  const requireGit = options?.requireGit !== false;
  const requireWrite = options?.requireWrite !== false;
  const workspacePath = workspace.workPath || workspace.baseRepoPath;
  const capabilities = workspace.capabilities ?? (await detectWorkspaceCapabilities(workspacePath));

  if (!capabilities.filesystem.readable) {
    return {
      ok: false,
      reason: capabilities.filesystem.reason || 'Workspace is not readable',
      reasonCode: 'LOOP_FAILED',
    };
  }

  if (requireWrite && !capabilities.filesystem.writable) {
    return {
      ok: false,
      reason: capabilities.filesystem.reason || 'Workspace is not writable',
      reasonCode: 'LOOP_FAILED',
    };
  }

  if (!capabilities.git.insideWorkTree) {
    if (!requireGit) {
      onEvent?.({
        type: 'resource.status',
        resource: 'git',
        status: 'skipped',
        message: capabilities.git.reason || text.loop.preflightFailedNotGit,
        timestamp: now(),
      });
    } else if (!capabilities.git.available) {
      return { ok: false, reason: text.loop.gitNotFound, reasonCode: 'PREFLIGHT_NOT_GIT' };
    } else {
      return {
        ok: false,
        reason: capabilities.git.reason
          ? text.loop.preflightGitCheckFailed(capabilities.git.reason)
          : text.loop.preflightFailedNotGit,
        reasonCode: 'PREFLIGHT_NOT_GIT',
      };
    }
  }

  if (!capabilities.git.insideWorkTree) {
    if (!(await isCommandAvailable('rg'))) {
      onEvent?.({
        type: 'resource.status',
        resource: 'ripgrep',
        status: 'warning',
        message: text.verify.ripgrepNotFoundWarning,
        timestamp: now(),
      });
    }
    return { ok: true, capabilities };
  }

  const git = new GitAdapter(workspacePath);

  // Check if workspace is dirty (only for direct strategy)
  // Allow dirty workspace by default for worktree strategy
  if (workspace.strategy === 'direct' && !options?.ignoreDirty) {
    const statusCheck = await git.execMeta(['status', '--porcelain'], {
      cwd: workspacePath,
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
    return { ok: true, capabilities };
  }

  if (workspace.strategy !== 'direct' || options?.ignoreDirty) {
    onEvent?.({
      type: 'resource.status',
      resource: 'git',
      status: 'skipped',
      message: text.verify.worktreeStrategyActive,
      timestamp: now(),
    });
  }

  // Check if ripgrep is installed (optional but recommended)
  if (!(await isCommandAvailable('rg'))) {
    onEvent?.({
      type: 'resource.status',
      resource: 'ripgrep',
      status: 'warning',
      message: text.verify.ripgrepNotFoundWarning,
      timestamp: now(),
    });
  }

  return { ok: true, capabilities };
}
