import { readFile } from 'fs/promises';
import path from 'path';

const DEFAULT_TIMEOUT_MS = 30_000;

async function loadMigratedFiles(repoRoot: string): Promise<string[]> {
  const listPath = path.join(repoRoot, 'tests', 'bun-migrated-files.json');
  const raw = await readFile(listPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('tests/bun-migrated-files.json must be a JSON array');
  }
  const files = parsed.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (files.length === 0) {
    throw new Error('tests/bun-migrated-files.json is empty');
  }
  return files;
}

async function main() {
  const repoRoot = process.cwd();
  const files = await loadMigratedFiles(repoRoot);
  const preloadPath = path.join(repoRoot, 'tests', 'setup-bun.ts');
  const timeoutMs = Number(process.env.BUN_MIGRATED_TEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const bunRuntime = (globalThis as { Bun?: { spawn: (cmd: string[], options: any) => any } }).Bun;
  if (!bunRuntime) {
    throw new Error('Bun runtime is required to execute migrated tests');
  }

  const failedFiles: string[] = [];

  for (const [index, file] of files.entries()) {
    process.stdout.write(`\n[${index + 1}/${files.length}] ${file}\n`);

    const subprocess = bunRuntime.spawn(
      [process.execPath, 'test', '--preload', preloadPath, file],
      {
        cwd: repoRoot,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
        env: process.env,
      },
    );
    const code = await Promise.race<number>([
      subprocess.exited,
      new Promise<number>((resolve) => {
        setTimeout(() => {
          try {
            subprocess.kill();
          } catch {
            // No-op: process may have already exited.
          }
          resolve(124);
        }, timeoutMs);
      }),
    ]);
    if (code !== 0) {
      failedFiles.push(code === 124 ? `${file} (timeout)` : file);
    }
  }

  if (failedFiles.length > 0) {
    process.stderr.write('\nBun migrated tests failed in:\n');
    for (const file of failedFiles) {
      process.stderr.write(`- ${file}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nAll ${files.length} migrated files passed under bun:test.\n`);
  process.exitCode = 0;
}

void main();
