import { spawn } from 'child_process';
import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

const PROJECT_ROOT = resolve(process.cwd());
const TSX_CLI = join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const SALMONLOOP_CLI_ENTRY = join(PROJECT_ROOT, 'src', 'cli', 'index.ts');

async function runSalmonLoopCli(args: string[], envOverrides?: Record<string, string>) {
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
    const child = spawn(process.execPath, [TSX_CLI, SALMONLOOP_CLI_ENTRY, ...args], {
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

describe('Config CLI integration', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('loads default repo config and redacts inline apiKey in --print-config output', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          verify: { command: 'node -e "process.exit(0)"' },
          llm: {
            active: 'openaiMain',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                client: { package: '@ai-sdk/openai' },
                api: {
                  baseUrl: 'https://example.com/v1',
                  apiKey: 'secret-inline-key',
                  timeoutMs: 60000,
                  headers: {},
                },
                models: {
                  default: { id: 'gpt-test' },
                },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout, stderr } = await runSalmonLoopCli([
      '-r',
      repo.path,
      '--print-config',
    ]);
    expect(stderr).toBe('');
    expect(exitCode).toBe(0);

    const printed = JSON.parse(stdout) as any;
    expect(printed.version).toBe(1);
    expect(printed.llm.providers.openaiMain.api.apiKey).toBe('[REDACTED]');
    expect(stdout).not.toContain('secret-inline-key');
  });

  it('fails when --config points to a missing file', async () => {
    const repo = await helper.createGitRepo();

    const { exitCode, stderr } = await runSalmonLoopCli([
      '-r',
      repo.path,
      '--config',
      'does-not-exist.json',
      '--print-config',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Config file not found');
  });

  it('does not load default repo config when --no-config-file is set', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify(
        {
          version: 1,
          llm: {
            active: 'openaiMain',
            providers: {
              openaiMain: {
                type: 'openai-compatible',
                api: { apiKey: 'secret-inline-key' },
                models: { default: { id: 'gpt-test' } },
              },
            },
          },
        },
        null,
        2,
      ),
    );

    const { exitCode, stdout, stderr } = await runSalmonLoopCli([
      '-r',
      repo.path,
      '--no-config-file',
      '--print-config',
    ]);

    expect(stderr).toBe('');
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ version: 1 });
  });

  it('fails with a readable error when default config contains invalid JSON', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(repo.path, '.salmonloop/config/config.json', '{');

    const { exitCode, stderr } = await runSalmonLoopCli(['-r', repo.path, '--print-config']);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Failed to parse config JSON');
  });

  it('fails with a readable error when config version is unsupported', async () => {
    const repo = await helper.createGitRepo();

    await helper.writeFile(
      repo.path,
      '.salmonloop/config/config.json',
      JSON.stringify({ version: 2 }, null, 2),
    );

    const { exitCode, stderr } = await runSalmonLoopCli(['-r', repo.path, '--print-config']);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Unsupported config version');
  });
});
