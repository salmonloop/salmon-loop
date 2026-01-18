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
    `salmon-loop-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.patch`
  );
  
  await writeFile(tempFile, diffText, 'utf8');
  
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['apply', '--3way', '--whitespace=nowarn', tempFile], { cwd: repoPath });
      
      let stderr = '';
      child.stderr?.on('data', (data) => stderr += data.toString());
      
      child.on('error', (err) => {
        reject(new Error(text.git.applySpawnFailed(String(err))));
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(text.git.applyFailed(stderr.trim())));
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

export async function rollbackFiles(repoPath: string, files: string[]): Promise<RollbackResult> {
  // Deduplicate and filter empty strings
  const attempted = Array.from(new Set(files)).filter(Boolean);
  
  if (attempted.length === 0) {
    return { ok: true, attempted: [], exitCode: 0, stdout: "", stderr: "" };
  }

  return new Promise((resolve) => {
    const child = spawn('git', ['checkout', '--', ...attempted], { cwd: repoPath });
    
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));

    child.on("error", (err) => {
      resolve({
        ok: false,
        attempted,
        exitCode: null,
        stdout,
        stderr: (stderr ? stderr + "\n" : "") + String(err),
      });
    });

    child.on("close", (code) => {
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

export async function getGitDiff(repoPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn('git', ['diff'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoPath
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
  });
}
