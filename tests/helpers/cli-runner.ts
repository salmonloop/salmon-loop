import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { delimiter, join, resolve } from 'path';

const PROJECT_ROOT = resolve(process.cwd());
const CLI_ENTRY = join(PROJECT_ROOT, 'src', 'cli', 'index.ts');

function resolveBunBinary(): string {
  const explicit = (process.env.BUN_BINARY || '').trim();
  if (explicit) return explicit;

  const home = process.env.HOME;
  if (home) {
    const candidate = join(home, '.bun', 'bin', 'bun');
    if (existsSync(candidate)) return candidate;
  }

  return 'bun';
}

export async function runCli(
  args: string[],
  envOverrides?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dotenvDir = await mkdtemp(join(tmpdir(), 'salmonloop-dotenv-'));
  const dotenvPath = join(dotenvDir, '.env');
  await writeFile(dotenvPath, '', 'utf8');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Prevent accidental loading of developer/user keys from a real .env in the repo root.
    DOTENV_CONFIG_PATH: dotenvPath,
    SALMONLOOP_API_KEY: '',
    S8P_API_KEY: '',
    ...envOverrides,
  };

  const home = process.env.HOME;
  if (home) {
    const bunBinDir = join(home, '.bun', 'bin');
    env.PATH = env.PATH ? `${bunBinDir}${delimiter}${env.PATH}` : bunBinDir;
  }

  const bunBinary = resolveBunBinary();

  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise) => {
    const child = spawn(bunBinary, [CLI_ENTRY, ...args], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      resolvePromise({
        exitCode: code ?? 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}
