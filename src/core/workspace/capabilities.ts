import { access, constants } from '../adapters/fs/node-fs.js';
import { GitAdapter } from '../adapters/git/git-adapter.js';
import { LIMITS } from '../config/limits.js';
import type { CheckpointStrategy, WorkspaceCapabilities } from '../types/loop.js';
import type { FlowMode } from '../types/runtime.js';

const PROBE_LIMITS = { maxStdoutBytes: 4_096, maxStderrChars: 4_096 } as const;

function gitFailureReason(result: {
  error?: { code?: string; message?: string };
  stderr?: string;
  stdoutTruncated?: boolean;
  stdout?: Buffer;
}): string {
  if (result.error?.code === 'ENOENT') return 'git executable not found';
  if (result.error?.message) return result.error.message;
  if (result.stdoutTruncated) return `git output exceeded ${PROBE_LIMITS.maxStdoutBytes} bytes`;
  const stderr = result.stderr?.trim();
  const stdout = result.stdout?.toString('utf8').trim();
  if (stdout) return `git reported --is-inside-work-tree=${stdout}`;
  return stderr || 'not a git work tree';
}

async function detectFileSystemCapability(
  workspacePath: string,
): Promise<WorkspaceCapabilities['filesystem']> {
  try {
    await access(workspacePath, constants.R_OK);
  } catch (error) {
    return {
      readable: false,
      writable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    await access(workspacePath, constants.W_OK);
    return { readable: true, writable: true };
  } catch (error) {
    return {
      readable: true,
      writable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function detectWorkspaceCapabilities(
  workspacePath: string,
): Promise<WorkspaceCapabilities> {
  const git = new GitAdapter(workspacePath);
  const gitCheck = await git.execMeta(['rev-parse', '--is-inside-work-tree'], {
    cwd: workspacePath,
    limits: PROBE_LIMITS,
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  let gitCapability: WorkspaceCapabilities['git'];
  const insideWorkTree = gitCheck.ok ? gitCheck.stdout.toString('utf8').trim() === 'true' : false;

  if (!gitCheck.ok || gitCheck.stdoutTruncated || !insideWorkTree) {
    gitCapability = {
      available: gitCheck.error?.code !== 'ENOENT',
      insideWorkTree: false,
      reason: gitFailureReason(gitCheck),
    };
  } else {
    const headResult = await git.execMeta(['rev-parse', '--verify', 'HEAD'], {
      cwd: workspacePath,
      limits: PROBE_LIMITS,
      timeoutMs: LIMITS.gitTimeoutMs,
    });
    gitCapability = {
      available: true,
      insideWorkTree: true,
      head: headResult.ok ? headResult.stdout.toString('utf8').trim() : undefined,
    };
  }

  return {
    git: gitCapability,
    filesystem: await detectFileSystemCapability(workspacePath),
  };
}

export function requiresGitWorkspace(params: {
  mode: FlowMode;
  strategy: CheckpointStrategy;
}): boolean {
  if (params.strategy === 'worktree' || params.strategy === 'tempCommit') {
    return true;
  }
  return params.mode !== 'autopilot';
}
