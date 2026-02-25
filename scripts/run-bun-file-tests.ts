import { readdir } from 'node:fs/promises';
import path from 'node:path';

// File-level timeout for a full test file run. Integration suites can exceed 30s under CI load.
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_PARALLELISM = 4;
const DEFAULT_PRELOAD = path.join('tests', 'setup-bun.ts');
const DEFAULT_TEST_TIMEOUT_MS = 30_000;

function isTestFile(name: string): boolean {
  return /\.(?:test|bench)\.(?:ts|tsx|js|jsx)$/.test(name);
}

async function collectTestFiles(repoRoot: string, rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(repoRoot, fullPath)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!isTestFile(entry.name)) continue;
    files.push(path.relative(repoRoot, fullPath).replace(/\\/g, '/'));
  }
  return files.sort();
}

function resolveParallelism(total: number): number {
  const fromEnv = Number(process.env.BUN_FILE_TEST_PARALLELISM || DEFAULT_PARALLELISM);
  const normalized =
    Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : DEFAULT_PARALLELISM;
  return Math.min(Math.max(normalized, 1), Math.max(total, 1));
}

async function runSingleTestFile(
  bunRuntime: { spawn: (cmd: string[], options: any) => any },
  repoRoot: string,
  preloadPath: string,
  file: string,
  timeoutMs: number,
  testTimeoutMs: number,
): Promise<number> {
  const fileArg = file.startsWith('.') ? file : `./${file}`;
  const subprocess = bunRuntime.spawn(
    [
      process.execPath,
      'test',
      '--timeout',
      String(testTimeoutMs),
      '--preload',
      preloadPath,
      fileArg,
    ],
    {
      cwd: repoRoot,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: process.env,
    },
  );

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
  if (timeoutId) clearTimeout(timeoutId);
  return code;
}

async function main() {
  const roots = process.argv.slice(2).filter(Boolean);
  if (roots.length === 0) {
    throw new Error('Usage: bun scripts/run-bun-file-tests.ts <dir> [...dirs]');
  }

  const repoRoot = process.cwd();
  const preloadPath = path.join(repoRoot, DEFAULT_PRELOAD);
  const timeoutMs = Number(process.env.BUN_FILE_TEST_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const testTimeoutMs = Number(process.env.BUN_TEST_CASE_TIMEOUT_MS || DEFAULT_TEST_TIMEOUT_MS);
  const bunRuntime = (globalThis as { Bun?: { spawn: (cmd: string[], options: any) => any } }).Bun;

  if (!bunRuntime) {
    throw new Error('Bun runtime is required to execute tests');
  }

  const allFiles = (
    await Promise.all(roots.map((root) => collectTestFiles(repoRoot, path.join(repoRoot, root))))
  ).flat();

  if (allFiles.length === 0) {
    throw new Error(`No test files found under: ${roots.join(', ')}`);
  }

  const parallelism = resolveParallelism(allFiles.length);
  process.stdout.write(
    `\nRunning ${allFiles.length} files under bun:test with parallelism=${parallelism}...\n`,
  );

  const failedFiles: string[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: parallelism }, async (_unused, workerIndex) => {
      while (true) {
        const index = cursor++;
        if (index >= allFiles.length) break;
        const file = allFiles[index];
        process.stdout.write(
          `\n[file ${index + 1}/${allFiles.length} | worker ${workerIndex + 1}] ${file}\n`,
        );
        const code = await runSingleTestFile(
          bunRuntime,
          repoRoot,
          preloadPath,
          file,
          timeoutMs,
          testTimeoutMs,
        );
        if (code !== 0) {
          failedFiles.push(code === 124 ? `${file} (timeout)` : file);
        }
      }
    }),
  );

  if (failedFiles.length > 0) {
    process.stderr.write('\nBun file tests failed in:\n');
    for (const file of failedFiles) {
      process.stderr.write(`- ${file}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\nAll ${allFiles.length} files passed under bun:test.\n`);
  process.exitCode = 0;
}

void main();
