import { spawn } from 'child_process';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const PROJECT_ROOT = resolve(process.cwd());
const TSX_CLI = join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI_ENTRY = join(PROJECT_ROOT, 'src', 'cli', 'index.ts');

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

  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise) => {
    const child = spawn(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
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
