import { spawn } from 'child_process';
import path from 'path';

import { LIMITS } from '../../limits.js';

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
  const rel = path.relative(resolvedRoot, resolvedCwd);
  if (rel === '') return;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `Refusing to run git outside repoRoot (cwd=${resolvedCwd}, repoRoot=${resolvedRoot})`,
    );
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

  return await new Promise((resolve) => {
    let killTimer: NodeJS.Timeout | undefined;

    const child = spawn('git', input.args, {
      cwd,
      env: {
        ...process.env,
        LC_ALL: 'C',
        GIT_OPTIONAL_LOCKS: '0',
        ...(input.env || {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      detached: !isWin,
    });

    let settled = false;
    const settle = (res: GitRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve(res);
    };

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stdoutTruncated = false;

    let stderr = '';
    let stderrTruncated = false;

    let timedOut = false;
    const killProcess = (signal: NodeJS.Signals) => {
      try {
        if (!isWin && typeof child.pid === 'number') {
          // Kill the whole process group to avoid leaving helper processes behind.
          process.kill(-child.pid, signal);
          return;
        }
      } catch {
        // Ignore, fall back to killing the child only.
      }
      try {
        child.kill(signal);
      } catch {
        // Ignore
      }
    };

    child.stdout?.on('data', (chunk) => {
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
    });

    child.stderr?.on('data', (chunk) => {
      if (stderrTruncated) return;
      const s = chunk.toString('utf8');
      if (stderr.length + s.length <= maxStderrChars) {
        stderr += s;
        return;
      }
      const remaining = Math.max(0, maxStderrChars - stderr.length);
      if (remaining > 0) stderr += s.slice(0, remaining);
      stderrTruncated = true;
    });

    child.on('error', (err: any) => {
      settle({
        ok: false,
        code: -1,
        signal: null,
        stdout: Buffer.concat(stdoutChunks),
        stderr: stderr || String(err?.message ?? err),
        timedOut: false,
        stdoutTruncated,
        stderrTruncated,
        error: { code: err?.code, message: String(err?.message ?? err) },
      });
    });

    child.on('close', (code, signal) => {
      settle({
        ok: !timedOut && code === 0,
        code,
        signal: (signal as NodeJS.Signals | null) ?? null,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
        timedOut,
        stdoutTruncated,
        stderrTruncated,
      });
    });

    if (input.input) {
      child.stdin?.write(input.input);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killProcess('SIGTERM');
      killTimer = setTimeout(() => {
        killProcess('SIGKILL');
      }, killGraceMs);
    }, timeoutMs);
  });
}
