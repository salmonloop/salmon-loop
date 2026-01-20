import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { text } from '../locales/index.js';

import { GitError } from './types.js';

const diffCache: Map<string, string | undefined> = new Map();

export function clearGitCache() {
  diffCache.clear();
}

export type RollbackResult = {
  ok: boolean;
  attempted: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export async function applyPatch(repoPath: string, diffText: string): Promise<void> {
  clearGitCache();
  // Preprocess diffText to remove index lines that might contain hallucinated hashes
  // We use a more robust filtering that handles potential leading/trailing whitespace
  const cleanedDiff = diffText
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('index '))
    .join('\n');

  const tempFile = join(
    tmpdir(),
    `salmon-loop-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.patch`,
  );

  await writeFile(tempFile, cleanedDiff, 'utf8');

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'git',
        [
          'apply',
          '-3', // the short option for --3way
          '--recount',
          '-C0', // allow zero context for fuzzing
          '--ignore-space-change',
          '--ignore-whitespace',
          tempFile,
        ],
        { cwd: repoPath },
      );

      let output = '';
      child.stdout?.on('data', (data) => (output += data.toString()));
      child.stderr?.on('data', (data) => (output += data.toString()));

      child.on('error', (err) => {
        reject(new GitError(text.git.applySpawnFailed(String(err)), 'git apply', String(err)));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new GitError(text.git.applyFailed(output.trim()), 'git apply', output.trim()));
        }
      });
    });
  } finally {
    try {
      await unlink(tempFile);
    } catch {
      // Ignore deletion errors
    }
  }
}

async function resolveConflicts(repoPath: string): Promise<{ ok: boolean; error?: string }> {
  let lastError: string | undefined;

  // 1. git stash to clear index (may fail if nothing to stash, that's ok)
  await new Promise<void>((resolve) => {
    const child = spawn('git', ['stash'], { cwd: repoPath });
    child.on('close', () => resolve());
    child.on('error', () => resolve());
  });

  // 2. git reset --hard HEAD - this MUST succeed
  const resetResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const child = spawn('git', ['reset', '--hard', 'HEAD'], { cwd: repoPath });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: `git reset --hard HEAD failed: ${stderr}` });
      }
    });
    child.on('error', (err) => {
      resolve({ ok: false, error: `git reset --hard HEAD spawn error: ${err}` });
    });
  });

  if (!resetResult.ok) {
    lastError = resetResult.error;
  }

  // 3. git clean -fd to remove untracked files (like .rej) - this MUST succeed
  const cleanResult = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    const child = spawn('git', ['clean', '-fd'], { cwd: repoPath });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        resolve({ ok: false, error: `git clean -fd failed: ${stderr}` });
      }
    });
    child.on('error', (err) => {
      resolve({ ok: false, error: `git clean -fd spawn error: ${err}` });
    });
  });

  if (!cleanResult.ok) {
    lastError = lastError ? `${lastError}; ${cleanResult.error}` : cleanResult.error;
  }

  // 4. Verify workspace is clean
  const statusResult = await new Promise<string>((resolve) => {
    const child = spawn('git', ['status', '--porcelain'], {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d.toString()));
    child.on('close', () => resolve(output.trim()));
    child.on('error', () => resolve(''));
  });

  if (statusResult) {
    // Workspace still has changes - this is a real failure
    return {
      ok: false,
      error: lastError
        ? `${lastError}; Workspace still dirty: ${statusResult}`
        : `Workspace still dirty after cleanup: ${statusResult}`,
    };
  }

  return { ok: true };
}

export async function rollbackFiles(
  repoPath: string,
  files: string[],
  forceReset = false,
): Promise<RollbackResult> {
  clearGitCache();
  // Path safety: filter out absolute paths or parent directory references
  const safeFiles = files
    .map((f) => f.trim().replace(/\\/g, '/'))
    .filter((f) => {
      if (!f) return false;
      // No absolute paths (Unix or Windows)
      if (f.startsWith('/') || /^[a-zA-Z]:\//.test(f)) return false;
      // No path traversal
      if (f.includes('..')) return false;
      // No empty or whitespace-only paths (already handled by trim and !f)
      return true;
    });

  // Deduplicate
  const attempted = Array.from(new Set(safeFiles));

  if (attempted.length === 0 && !forceReset) {
    return { ok: true, attempted: [], exitCode: 0, stdout: '', stderr: '' };
  }

  return new Promise((resolve) => {
    // If forceReset is true, execute git reset --hard HEAD
    // Otherwise, try to checkout specified files
    const args = forceReset ? ['reset', '--hard', 'HEAD'] : ['checkout', '--', ...attempted];
    const child = spawn('git', args, { cwd: repoPath });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      resolve({
        ok: false,
        attempted,
        exitCode: null,
        stdout,
        stderr: (stderr ? stderr + '\n' : '') + String(err),
      });
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        // If checkout failed, we must ensure the repo is clean.
        // We try resolveConflicts as a fallback to handle any git error or conflict state.
        const conflictResult = await resolveConflicts(repoPath);
        if (!conflictResult.ok) {
          // resolveConflicts failed - this is a real rollback failure
          resolve({
            ok: false,
            attempted,
            exitCode: code,
            stdout,
            stderr: stderr + '\n' + (conflictResult.error || 'resolveConflicts failed'),
          });
          return;
        }
        resolve({
          ok: true,
          attempted,
          exitCode: 0,
          stdout,
          stderr: stderr + '\nForced rollback via resolveConflicts due to git error',
        });
        return;
      }

      if (code === 0 && forceReset) {
        // If reset succeeded and forceReset is true, also perform git clean -fd
        try {
          await new Promise<void>((res, rej) => {
            const cleanChild = spawn('git', ['clean', '-fd'], { cwd: repoPath });
            cleanChild.on('close', (cleanCode) => (cleanCode === 0 ? res() : rej()));
            cleanChild.on('error', rej);
          });
        } catch (e) {
          // Log clean failure but don't necessarily fail the whole rollback
          stderr += `\nWarning: git clean -fd failed: ${String(e)}`;
        }
      }

      // Final verification: ensure workspace is actually clean
      const finalStatus = await new Promise<string>((res) => {
        const statusChild = spawn('git', ['status', '--porcelain'], {
          cwd: repoPath,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        statusChild.stdout.on('data', (d) => (output += d.toString()));
        statusChild.on('close', () => res(output.trim()));
        statusChild.on('error', () => res(''));
      });

      if (finalStatus) {
        // Workspace still dirty after rollback - try one more time with resolveConflicts
        const conflictResult = await resolveConflicts(repoPath);
        if (!conflictResult.ok) {
          resolve({
            ok: false,
            attempted,
            exitCode: code,
            stdout,
            stderr: stderr + `\nWorkspace still dirty after rollback: ${finalStatus}\n${conflictResult.error || ''}`,
          });
          return;
        }
      }

      resolve({
        ok: true,
        attempted,
        exitCode: code,
        stdout,
        stderr,
      });
    });
  });
}

export async function getGitDiff(
  repoPath: string,
  cached = false,
  file?: string,
): Promise<string | undefined> {
  const cacheKey = `${repoPath}:${cached}:${file || ''}`;
  if (diffCache.has(cacheKey)) {
    return diffCache.get(cacheKey);
  }

  return new Promise((resolve) => {
    const args = ['diff'];
    if (cached) args.push('--cached');
    if (file) args.push('--', file);

    const child = spawn('git', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoPath,
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      const result = code === 0 && output.trim() ? output : undefined;
      diffCache.set(cacheKey, result);
      resolve(result);
    });

    child.on('error', () => {
      resolve(undefined);
    });
  });
}

export async function getGitStatus(repoPath: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', ['status', '--short'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoPath,
    });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', () => {
      resolve(output.trim());
    });

    child.on('error', () => {
      resolve('');
    });
  });
}
