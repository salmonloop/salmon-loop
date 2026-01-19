import { writeFile, unlink } from 'fs/promises';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { join } from 'path';
import { text } from '../locales/index.js';

export type RollbackResult = {
  ok: boolean;
  attempted: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export async function applyPatch(repoPath: string, diffText: string): Promise<void> {
  const tempFile = join(
    tmpdir(),
    `salmon-loop-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.patch`,
  );

  await writeFile(tempFile, diffText, 'utf8');

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'git',
        ['apply', '--3way', '--recount', '--whitespace=nowarn', tempFile],
        { cwd: repoPath },
      );

      let output = '';
      child.stdout?.on('data', (data) => (output += data.toString()));
      child.stderr?.on('data', (data) => (output += data.toString()));

      child.on('error', (err) => {
        reject(new Error(text.git.applySpawnFailed(String(err))));
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(text.git.applyFailed(output.trim())));
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

export async function rollbackFiles(
  repoPath: string,
  files: string[],
  forceReset = false,
): Promise<RollbackResult> {
  // Path safety: filter out absolute paths or parent directory references
  const safeFiles = files
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f && !f.startsWith('/') && !f.includes('..'));

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

      resolve({
        ok: code === 0,
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
      if (code === 0 && output.trim()) {
        resolve(output);
      } else {
        resolve(undefined);
      }
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
