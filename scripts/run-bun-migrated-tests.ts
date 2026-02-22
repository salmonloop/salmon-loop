import { readFile } from 'fs/promises';
import path from 'path';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ISOLATION_LIST_PATH = path.join('tests', 'bun-isolated-files.json');
const DEFAULT_PARALLELISM = 4;

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

async function loadIsolatedFiles(repoRoot: string): Promise<Set<string>> {
  const listPath = path.join(repoRoot, DEFAULT_ISOLATION_LIST_PATH);
  const raw = await readFile(listPath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${DEFAULT_ISOLATION_LIST_PATH} must be a JSON array`);
  }
  const files = parsed.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return new Set(files);
}

async function runSingleTestFile(
  bunRuntime: { spawn: (cmd: string[], options: any) => any },
  repoRoot: string,
  preloadPath: string,
  file: string,
  timeoutMs: number,
): Promise<number> {
  const subprocess = bunRuntime.spawn([process.execPath, 'test', '--preload', preloadPath, file], {
    cwd: repoRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    env: process.env,
  });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<number>((resolve) => {
    timeoutId = setTimeout(() => {
      try {
        subprocess.kill();
      } catch {
        // No-op: process may have already exited.
      }
      resolve(124);
    }, timeoutMs);
  });
  const code = await Promise.race<number>([subprocess.exited, timeoutPromise]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  return code;
}

function resolveParallelism(sharedCount: number): number {
  const fromEnv = Number(process.env.BUN_MIGRATED_PARALLELISM || DEFAULT_PARALLELISM);
  const normalized =
    Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : DEFAULT_PARALLELISM;
  return Math.min(Math.max(normalized, 1), Math.max(sharedCount, 1));
}

async function main() {
  const repoRoot = process.cwd();
  const files = await loadMigratedFiles(repoRoot);
  const isolatedFiles = await loadIsolatedFiles(repoRoot);
  const preloadPath = path.join(repoRoot, 'tests', 'setup-bun.ts');
  const timeoutMs = Number(process.env.BUN_MIGRATED_TEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const bunRuntime = (globalThis as { Bun?: { spawn: (cmd: string[], options: any) => any } }).Bun;
  if (!bunRuntime) {
    throw new Error('Bun runtime is required to execute migrated tests');
  }

  const failedFiles: string[] = [];
  const isolated = files.filter((file) => isolatedFiles.has(file));
  const shared = files.filter((file) => !isolatedFiles.has(file));

  if (shared.length > 0) {
    const parallelism = resolveParallelism(shared.length);
    process.stdout.write(
      `\nRunning ${shared.length} shared-safe files with parallelism=${parallelism}...\n`,
    );
    let cursor = 0;
    await Promise.all(
      Array.from({ length: parallelism }, async (_unused, workerIndex) => {
        while (true) {
          const index = cursor++;
          if (index >= shared.length) {
            break;
          }
          const file = shared[index];
          process.stdout.write(
            `\n[shared ${index + 1}/${shared.length} | worker ${workerIndex + 1}] ${file}\n`,
          );
          const code = await runSingleTestFile(bunRuntime, repoRoot, preloadPath, file, timeoutMs);
          if (code !== 0) {
            failedFiles.push(code === 124 ? `${file} (timeout)` : file);
          }
        }
      }),
    );
  }

  if (isolated.length > 0) {
    process.stdout.write(`\nRunning ${isolated.length} isolated files sequentially...\n`);
    for (const [index, file] of isolated.entries()) {
      process.stdout.write(`\n[isolated ${index + 1}/${isolated.length}] ${file}\n`);
      const code = await runSingleTestFile(bunRuntime, repoRoot, preloadPath, file, timeoutMs);
      if (code !== 0) {
        failedFiles.push(code === 124 ? `${file} (timeout)` : file);
      }
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
