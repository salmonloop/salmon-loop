import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { delimiter, join, resolve } from 'path';

import { RealFsTestHelper } from '../helpers/real-fs-helper.js';
import { waitForPath } from '../helpers/wait-for.js';

const PROJECT_ROOT = resolve(process.cwd());
const CLI_ENTRY = join(PROJECT_ROOT, 'src', 'cli', 'index.ts');

export type OutputFormat = 'text' | 'json' | 'stream-json';
export type Strategy = 'direct' | 'worktree';
export type EnvironmentMode = 'strict' | 'parity';

export interface RepoSetupOptions {
  strategy: Strategy;
  verifyCommand: string;
  files?: Array<{ path: string; content: string }>;
  dirtyFile?: { path: string; content: string };
}

export interface RunOptions {
  instruction: string;
  outputFormat: OutputFormat;
  environmentMode: EnvironmentMode;
  strategy?: Strategy;
  applyBackOnDirty?: 'abort' | '3way' | 'none';
  verifyCommand?: string;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  audit: any;
  outputJson?: any;
  outputJsonl?: any[];
}

export interface PreparedRepo {
  path: string;
  cleanup: () => Promise<void>;
}

function resolveBunBinary(): string {
  const explicit = (process.env.BUN_BINARY || '').trim();
  if (explicit) return explicit;
  if (process.execPath && /(^|\/|\\)bun(\.exe)?$/i.test(process.execPath)) {
    return process.execPath;
  }
  const home = process.env.HOME;
  if (home) {
    const candidate = join(home, '.bun', 'bin', 'bun');
    if (existsSync(candidate)) return candidate;
  }
  return 'bun';
}

function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function buildConfigYaml(options: { strategy: Strategy; verifyCommand: string }): string {
  return [
    'version: 1',
    'cli:',
    '  defaults:',
    `    strategy: ${options.strategy}`,
    '    dry_run: false',
    'verify:',
    `  command: ${yamlString(options.verifyCommand)}`,
    'llm:',
    '  active_model: main',
    '  providers:',
    '    openaiMain:',
    '      type: openai-compatible',
    '      client:',
    '        package: "@ai-sdk/openai-compatible"',
    '      api:',
    '        base_url: "https://api.openai.com/v1"',
    '        api_key: null',
    '  models:',
    '    main:',
    '      provider: openaiMain',
    '      id: "gpt-4.1-mini"',
    '',
  ].join('\n');
}

async function writeRepoConfig(repoPath: string, configYaml: string): Promise<void> {
  const configDir = join(repoPath, '.salmonloop', 'config');
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'config.yaml'), configYaml, 'utf8');
}

export async function prepareRepo(options: RepoSetupOptions): Promise<PreparedRepo> {
  const helper = new RealFsTestHelper();
  const baseFiles = options.files ?? [{ path: 'example.txt', content: 'Hello\nTest\nEnd\n' }];
  const packageJson = JSON.stringify(
    {
      name: 'e2e-repo',
      version: '1.0.0',
      private: true,
    },
    null,
    2,
  );
  const initialFiles = [
    ...baseFiles,
    { path: 'package.json', content: packageJson },
    { path: '.gitignore', content: '.salmonloop/\n' },
  ];

  const repo = await helper.createGitRepo({
    initialFiles,
  });

  const configYaml = buildConfigYaml({
    strategy: options.strategy,
    verifyCommand: options.verifyCommand,
  });
  await writeRepoConfig(repo.path, configYaml);

  if (options.dirtyFile) {
    await helper.writeFile(repo.path, options.dirtyFile.path, options.dirtyFile.content);
  }

  return {
    path: repo.path,
    cleanup: () => helper.cleanup(),
  };
}

export async function findLatestAudit(repoPath: string): Promise<any> {
  const auditDir = join(repoPath, '.salmonloop', 'runtime', 'audit');
  const entries = await readdir(auditDir);
  const auditFiles = entries.filter(
    (entry) => entry.startsWith('audit-') && entry.endsWith('.json'),
  );
  if (auditFiles.length === 0) {
    throw new Error(`No audit json found under ${auditDir}`);
  }

  const withStats = await Promise.all(
    auditFiles.map(async (file) => {
      const full = join(auditDir, file);
      const stats = await stat(full);
      return { file, full, mtimeMs: stats.mtimeMs };
    }),
  );

  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const latest = withStats[0];
  const raw = await readFile(latest.full, 'utf8');
  return JSON.parse(raw);
}

async function spawnCli(
  repoPath: string,
  args: string[],
  envOverrides?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dotenvDir = await mkdtemp(join(tmpdir(), 'salmonloop-e2e-dotenv-'));
  const dotenvPath = join(dotenvDir, '.env');
  await writeFile(dotenvPath, '', 'utf8');

  const tempHome = await mkdtemp(join(tmpdir(), 'salmonloop-e2e-home-'));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DOTENV_CONFIG_PATH: dotenvPath,
    HOME: tempHome,
    ...envOverrides,
  };

  const home = process.env.HOME;
  if (home) {
    const bunBinDir = join(home, '.bun', 'bin');
    env.PATH = env.PATH ? `${bunBinDir}${delimiter}${env.PATH}` : bunBinDir;
  }

  const bunBinary = resolveBunBinary();

  return new Promise((resolvePromise, reject) => {
    const child = spawn(bunBinary, [CLI_ENTRY, ...args], {
      cwd: repoPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));

    child.on('error', reject);
    child.on('close', async (code) => {
      await rm(dotenvDir, { recursive: true, force: true });
      await rm(tempHome, { recursive: true, force: true });
      resolvePromise({ exitCode: code ?? 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function parseJsonOutput(stdout: string): any {
  if (!stdout) return undefined;
  return JSON.parse(stdout);
}

function parseJsonLines(stdout: string): any[] {
  if (!stdout) return [];
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function runScenario(repoPath: string, options: RunOptions): Promise<RunResult> {
  const args: string[] = [
    'run',
    '--repo',
    repoPath,
    '--instruction',
    options.instruction,
    '--environment-mode',
    options.environmentMode,
    '--output-format',
    options.outputFormat,
  ];

  if (options.strategy) {
    args.push('--checkpoint-strategy', options.strategy);
  }

  if (options.applyBackOnDirty) {
    args.push('--apply-back-on-dirty', options.applyBackOnDirty);
  }

  if (options.verifyCommand) {
    args.push('--verify', options.verifyCommand);
  }

  const result = await spawnCli(repoPath, args);
  const audit = await findLatestAudit(repoPath);

  const outputJson = options.outputFormat === 'json' ? parseJsonOutput(result.stdout) : undefined;
  const outputJsonl =
    options.outputFormat === 'stream-json' ? parseJsonLines(result.stdout) : undefined;

  return {
    ...result,
    audit,
    outputJson,
    outputJsonl,
  };
}

export async function readRepoFile(repoPath: string, filePath: string): Promise<string> {
  return readFile(join(repoPath, filePath), 'utf8');
}

export async function waitForAuditDir(repoPath: string): Promise<void> {
  await waitForPath(join(repoPath, '.salmonloop', 'runtime', 'audit'));
}

export async function runWithFallback(
  repoPath: string,
  options: RunOptions & { allowFallback?: boolean },
): Promise<RunResult> {
  const hasApiKey = Boolean(process.env.SALMONLOOP_API_KEY || process.env.S8P_API_KEY);
  const shouldFallback = Boolean(options.allowFallback && hasApiKey);

  const primary = await runScenario(repoPath, options);
  if (!shouldFallback || primary.exitCode === 0) return primary;

  const envOverrides = { SALMONLOOP_API_KEY: '', S8P_API_KEY: '' };
  const args: string[] = [
    'run',
    '--repo',
    repoPath,
    '--instruction',
    options.instruction,
    '--environment-mode',
    options.environmentMode,
    '--output-format',
    options.outputFormat,
  ];

  if (options.strategy) {
    args.push('--checkpoint-strategy', options.strategy);
  }

  if (options.applyBackOnDirty) {
    args.push('--apply-back-on-dirty', options.applyBackOnDirty);
  }

  if (options.verifyCommand) {
    args.push('--verify', options.verifyCommand);
  }

  const result = await spawnCli(repoPath, args, envOverrides);
  const audit = await findLatestAudit(repoPath);

  const outputJson = options.outputFormat === 'json' ? parseJsonOutput(result.stdout) : undefined;
  const outputJsonl =
    options.outputFormat === 'stream-json' ? parseJsonLines(result.stdout) : undefined;

  return {
    ...result,
    audit,
    outputJson,
    outputJsonl,
  };
}
