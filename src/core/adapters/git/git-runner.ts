import { realpathSync } from 'fs';
import path from 'path';

import { LIMITS } from '../../config/limits.js';
import { spawnCommand } from '../../runtime/process-runner.js';

export interface GitRunLimits {
  /**
   * Maximum bytes captured from stdout. Extra bytes are discarded.
   * Defaults to Infinity (no limit).
   */
  maxStdoutBytes?: number;
  /**
   * Maximum characters captured from stderr. Extra characters are discarded.
   * Defaults to Infinity (no limit).
   */
  maxStderrChars?: number;
}

export interface GitRunInput {
  repoRoot: string;
  args: string[];
  /**
   * Optional working directory. Must be within repoRoot.
   * Defaults to repoRoot.
   */
  cwd?: string;
  env?: Record<string, string>;
  input?: Buffer;
  timeoutMs?: number;
  limits?: GitRunLimits;
}

export interface GitRunResult {
  ok: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  error?: { code?: string; message: string };
}

function assertCwdSandboxed(repoRoot: string, cwd: string): void {
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedCwd = path.resolve(cwd);
  let realRoot = resolvedRoot;
  let realCwd = resolvedCwd;
  try {
    realRoot = realpathSync(resolvedRoot);
  } catch {
    realRoot = resolvedRoot;
  }
  try {
    realCwd = realpathSync(resolvedCwd);
  } catch {
    realCwd = resolvedCwd;
  }

  const rel = path.relative(realRoot, realCwd);
  if (rel === '') return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to run git outside repoRoot (cwd=${realCwd}, repoRoot=${realRoot})`);
  }
}

/**
 * Spawn `git` with a cwd sandbox and captured output.
 *
 * This function is intentionally low-level: it never throws for runtime failures
 * (non-zero exit, spawn errors, timeouts). Callers decide whether to treat them
 * as fatal.
 */
export async function runGitCommand(input: GitRunInput): Promise<GitRunResult> {
  const cwd = input.cwd ?? input.repoRoot;
  assertCwdSandboxed(input.repoRoot, cwd);

  const maxStdoutBytes = input.limits?.maxStdoutBytes ?? Infinity;
  const maxStderrChars = input.limits?.maxStderrChars ?? Infinity;
  const timeoutMs = input.timeoutMs ?? LIMITS.gitTimeoutMs;
  const killGraceMs = LIMITS.gitKillGraceMs;
  const isWin = process.platform === 'win32';

  const stdoutChunks: Buffer[] = [];
  let stdoutBytes = 0;
  let stdoutTruncated = false;

  let stderr = '';
  let stderrTruncated = false;

  const result = await spawnCommand({
    command: 'git',
    args: input.args,
    cwd,
    env: {
      ...process.env,
      LC_ALL: 'C',
      GIT_OPTIONAL_LOCKS: '0',
      ...(input.env || {}),
    },
    stdin: input.input,
    timeoutMs,
    killGraceMs,
    windowsHide: true,
    detached: !isWin,
    onStdoutChunk: (chunk) => {
      if (stdoutTruncated) return;
      const buf = Buffer.from(chunk);
      const nextBytes = stdoutBytes + buf.length;
      if (nextBytes <= maxStdoutBytes) {
        stdoutChunks.push(buf);
        stdoutBytes = nextBytes;
        return;
      }

      const remaining = Math.max(0, maxStdoutBytes - stdoutBytes);
      if (remaining > 0) {
        stdoutChunks.push(buf.subarray(0, remaining));
        stdoutBytes += remaining;
      }
      stdoutTruncated = true;
    },
    onStderrChunk: (chunk) => {
      if (stderrTruncated) return;
      const s = Buffer.from(chunk).toString('utf8');
      if (stderr.length + s.length <= maxStderrChars) {
        stderr += s;
        return;
      }
      const remaining = Math.max(0, maxStderrChars - stderr.length);
      if (remaining > 0) stderr += s.slice(0, remaining);
      stderrTruncated = true;
    },
  });

  if (result.error) {
    return {
      ok: false,
      code: -1,
      signal: null,
      stdout: Buffer.concat(stdoutChunks),
      stderr: stderr || result.error.message,
      timedOut: false,
      stdoutTruncated,
      stderrTruncated,
      error: result.error,
    };
  }

  return {
    ok: !result.timedOut && result.code === 0,
    code: result.code,
    signal: result.signal,
    stdout: Buffer.concat(stdoutChunks),
    stderr,
    timedOut: result.timedOut,
    stdoutTruncated,
    stderrTruncated,
  };
}
