import { mkdtemp, rm } from 'fs/promises';
import os from 'os';

import { Command, Option } from 'commander';
import { execa } from 'execa';

import { FileAdapter } from '../src/core/adapters/fs/file-adapter.js';
import { GitAdapter } from '../src/core/adapters/git/git-adapter.js';
import { defaultPathAdapter } from '../src/core/adapters/path/path-adapter.js';

type Semver = {
  major: number;
  minor: number;
  patch: number;
  raw: string;
};

const DEFAULT_GIT_NETWORK_TIMEOUT_MS = 2 * 60 * 1000;
const GIT_NETWORK_TIMEOUT_MS =
  Number(process.env.SALMONLOOP_GIT_NETWORK_TIMEOUT_MS) || DEFAULT_GIT_NETWORK_TIMEOUT_MS;

function parseSemver(input: string): Semver {
  const trimmed = input.trim();
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (!match) {
    throw new Error(`Invalid version "${input}". Expected "x.y.z" (e.g. "0.2.1").`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    throw new Error(`Invalid version "${input}". Expected numeric "x.y.z".`);
  }
  return { major, minor, patch, raw: trimmed };
}

function bumpSemver(current: Semver, bump: 'patch' | 'minor' | 'major'): Semver {
  if (bump === 'patch') return { ...current, patch: current.patch + 1, raw: '' };
  if (bump === 'minor') return { ...current, minor: current.minor + 1, patch: 0, raw: '' };
  return { ...current, major: current.major + 1, minor: 0, patch: 0, raw: '' };
}

function formatSemver(version: Semver): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function toTag(version: string): string {
  return version.startsWith('v') ? version : `v${version}`;
}

async function run(
  cmd: string,
  args: string[],
  options?: { cwd?: string; stdio?: 'inherit' | 'pipe'; reject?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa(cmd, args, {
    cwd: options?.cwd,
    stdio: options?.stdio ?? 'pipe',
    reject: options?.reject ?? false,
    env: process.env,
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode ?? 1,
  };
}

async function runGit(
  cwd: string,
  args: string[],
  options?: { timeoutMs?: number },
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  signal: string | null;
}> {
  const git = new GitAdapter(cwd);
  const result = await git.execMeta(args, { cwd, timeoutMs: options?.timeoutMs });
  const stdout = result.stdout.toString('utf8');
  const stderr = result.stderr || result.error?.message || '';
  return {
    stdout,
    stderr,
    exitCode: typeof result.code === 'number' ? result.code : 1,
    timedOut: result.timedOut,
    signal: result.signal ?? null,
  };
}

function formatGitFailure(res: {
  exitCode: number;
  stderr: string;
  timedOut: boolean;
  signal: string | null;
}): string {
  const parts: string[] = [];
  if (res.timedOut) parts.push('timed out');
  if (res.signal) parts.push(`signal=${res.signal}`);
  parts.push(`exitCode=${res.exitCode}`);
  const err = (res.stderr || '').trim();
  if (err) parts.push(err);
  return parts.join(' | ');
}

async function assertGitRepo(cwd: string): Promise<void> {
  const res = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (res.exitCode !== 0 || res.stdout.trim() !== 'true') {
    throw new Error('Not inside a Git work tree.');
  }
}

async function getGitBranch(cwd: string): Promise<string> {
  const res = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (res.exitCode !== 0) {
    throw new Error((res.stderr || '').trim() || 'Failed to determine current Git branch.');
  }
  return res.stdout.trim();
}

async function getGitStatusPorcelain(cwd: string): Promise<string> {
  const res = await runGit(cwd, ['status', '--porcelain=v1']);
  if (res.exitCode !== 0) {
    throw new Error((res.stderr || '').trim() || 'Failed to read Git status.');
  }
  return res.stdout.trim();
}

async function gitFetch(cwd: string, remote: string): Promise<void> {
  const res = await runGit(cwd, ['fetch', '--prune', remote], {
    timeoutMs: GIT_NETWORK_TIMEOUT_MS,
  });
  if (res.exitCode !== 0) {
    throw new Error(`git fetch failed: ${formatGitFailure(res)}`);
  }
}

async function assertUpToDateWithUpstream(cwd: string): Promise<void> {
  const res = await runGit(cwd, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  if (res.exitCode !== 0) {
    // No upstream configured: do not block releasing.
    return;
  }
  const upstream = res.stdout.trim();
  if (!upstream) return;

  const counts = await runGit(cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
  if (counts.exitCode !== 0) {
    throw new Error((counts.stderr || '').trim() || 'Failed to compare with upstream.');
  }

  const parts = counts.stdout.trim().split(/\s+/);
  const behind = Number(parts[0] ?? '0');
  const ahead = Number(parts[1] ?? '0');
  if (Number.isFinite(behind) && behind > 0) {
    throw new Error(
      `Branch is behind upstream by ${behind} commit(s). Pull/rebase before cutting a release.`,
    );
  }
  // Ahead is allowed: the release commit itself may be ahead.
  void ahead;
}

async function assertTagDoesNotExist(cwd: string, tag: string): Promise<void> {
  const res = await runGit(cwd, ['tag', '--list', tag]);
  if (res.exitCode !== 0) {
    throw new Error((res.stderr || '').trim() || 'Failed to check Git tags.');
  }
  if (res.stdout.trim() === tag) {
    throw new Error(`Tag "${tag}" already exists.`);
  }
}

async function readPackageJson(cwd: string): Promise<{ path: string; json: any }> {
  const pkgPath = defaultPathAdapter.join(cwd, 'package.json');
  const fileAdapter = new FileAdapter();
  const content = await fileAdapter.readFile(pkgPath, 'utf-8');
  const json = JSON.parse(content) as any;
  return { path: pkgPath, json };
}

async function writePackageJson(pkgPath: string, json: unknown): Promise<void> {
  const content = `${JSON.stringify(json, null, 2)}\n`;
  const fileAdapter = new FileAdapter();
  await fileAdapter.writeFile(pkgPath, content);
}

async function hasNpmCli(): Promise<boolean> {
  const res = await run('npm', ['--version'], { stdio: 'pipe' });
  return res.exitCode === 0;
}

async function assertNpmAuth(cwd: string): Promise<void> {
  if (!(await hasNpmCli())) {
    throw new Error('npm is not available in PATH. Install Node.js/npm before publishing.');
  }

  const res = await run('npm', ['whoami'], { cwd, stdio: 'pipe' });
  if (res.exitCode !== 0) {
    throw new Error(
      [
        'npm authentication check failed.',
        'Run `npm login` (or configure your npm token) and retry.',
        (res.stderr || res.stdout || '').trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
}

async function createPackArtifact(cwd: string, packDestination?: string): Promise<string> {
  const args = ['pack', '--json'];
  if (packDestination) {
    args.push('--pack-destination', packDestination);
  }

  const res = await run('npm', args, { cwd, stdio: 'pipe' });
  if (res.exitCode !== 0) {
    throw new Error((res.stderr || '').trim() || '`npm pack` failed.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout);
  } catch {
    throw new Error('Failed to parse `npm pack --json` output.');
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('`npm pack --json` did not return a tarball descriptor.');
  }

  const filename = parsed[0] && typeof parsed[0] === 'object' ? (parsed[0] as any).filename : '';
  if (typeof filename !== 'string' || !filename.trim()) {
    throw new Error('`npm pack --json` did not include a tarball filename.');
  }

  return defaultPathAdapter.join(packDestination ?? cwd, filename);
}

async function assertReleaseArtifact(options: { cwd: string; tarballPath: string }): Promise<void> {
  const tempRoot = await mkdtemp(defaultPathAdapter.join(os.tmpdir(), 'salmon-loop-release-'));
  const installDir = defaultPathAdapter.join(tempRoot, 'install');

  try {
    const installRes = await run('npm', ['install', '--prefix', installDir, options.tarballPath], {
      cwd: options.cwd,
      stdio: 'inherit',
    });
    if (installRes.exitCode !== 0) {
      throw new Error('Failed to install packed tarball into a temporary directory.');
    }

    const binName = process.platform === 'win32' ? 's8p.cmd' : 's8p';
    const binPath = defaultPathAdapter.join(installDir, 'node_modules', '.bin', binName);
    const smokeCommands = [['--help'], ['run', '--help'], ['serve', '--help']];

    for (const args of smokeCommands) {
      const smokeRes = await run(binPath, args, { cwd: installDir, stdio: 'inherit' });
      if (smokeRes.exitCode !== 0) {
        throw new Error(`Smoke test failed for: s8p ${args.join(' ')}`.trim());
      }
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function runPackagingChecks(cwd: string): Promise<void> {
  const packRoot = await mkdtemp(defaultPathAdapter.join(os.tmpdir(), 'salmon-loop-pack-'));
  const tarballPath = await createPackArtifact(cwd, packRoot);
  try {
    await assertReleaseArtifact({ cwd, tarballPath });
  } finally {
    await rm(packRoot, { recursive: true, force: true });
  }
}

async function publishPackage(options: {
  cwd: string;
  apply: boolean;
  tag?: string;
  otp?: string;
  access?: 'public' | 'restricted';
}): Promise<void> {
  if (!(await hasNpmCli())) {
    throw new Error('npm is not available in PATH. Install Node.js/npm before publishing.');
  }

  const args = ['publish'];
  if (options.tag) args.push('--tag', options.tag);
  if (options.otp) args.push('--otp', options.otp);
  if (options.access) args.push('--access', options.access);

  if (!options.apply) {
    process.stdout.write(`[dry-run] npm ${args.join(' ')}\n`);
    return;
  }

  await assertNpmAuth(options.cwd);

  const res = await run('npm', args, { cwd: options.cwd, stdio: 'inherit' });
  if (res.exitCode !== 0) {
    throw new Error('npm publish failed.');
  }
}

async function cutRelease(options: {
  cwd: string;
  branch: string;
  remote: string;
  fetch: boolean;
  allowDirty: boolean;
  bump?: 'patch' | 'minor' | 'major';
  version?: string;
  verify: boolean;
  build: boolean;
  apply: boolean;
  push: boolean;
  publish: boolean;
  npmTag?: string;
  npmOtp?: string;
  npmAccess?: 'public' | 'restricted';
  packageCheck: boolean;
}): Promise<void> {
  await assertGitRepo(options.cwd);

  if (options.fetch) {
    await gitFetch(options.cwd, options.remote);
  }

  const currentBranch = await getGitBranch(options.cwd);
  if (currentBranch !== options.branch) {
    throw new Error(
      `Refusing to cut a release on branch "${currentBranch}". Expected "${options.branch}".`,
    );
  }

  await assertUpToDateWithUpstream(options.cwd);

  const status = await getGitStatusPorcelain(options.cwd);
  if (status && !options.allowDirty) {
    throw new Error(
      [
        'Refusing to cut a release from a dirty workspace.',
        'Commit/stash your changes (including untracked files) and try again.',
        '',
        'Git status (porcelain):',
        status,
      ].join('\n'),
    );
  }

  const { path: pkgPath, json: pkg } = await readPackageJson(options.cwd);
  const currentVersion = parseSemver(String(pkg.version ?? ''));

  let nextVersion: string;
  if (options.version) {
    nextVersion = formatSemver(parseSemver(options.version));
  } else if (options.bump) {
    nextVersion = formatSemver(bumpSemver(currentVersion, options.bump));
  } else {
    throw new Error('Provide either --version x.y.z or --bump <patch|minor|major>.');
  }

  const tag = toTag(nextVersion);
  await assertTagDoesNotExist(options.cwd, tag);

  if (options.verify) {
    const verifyRes = await run('bun', ['run', 'verify'], { cwd: options.cwd, stdio: 'inherit' });
    if (verifyRes.exitCode !== 0) {
      throw new Error('`bun run verify` failed. Fix issues before cutting a release.');
    }
  }

  if (options.build) {
    const buildRes = await run('bun', ['run', 'build'], { cwd: options.cwd, stdio: 'inherit' });
    if (buildRes.exitCode !== 0) {
      throw new Error('`bun run build` failed. Fix issues before cutting a release.');
    }
  }

  if (options.packageCheck) {
    await runPackagingChecks(options.cwd);
  }

  if (options.publish && options.apply) {
    await assertNpmAuth(options.cwd);
  }

  if (!options.apply) {
    process.stdout.write(
      [
        '[dry-run] Planned actions:',
        `- Update package.json version: ${currentVersion.raw} -> ${nextVersion}`,
        `- Commit: chore(release): ${tag}`,
        `- Tag: ${tag}`,
        options.packageCheck
          ? '- Package checks: npm pack + temporary install + CLI smoke tests'
          : '- Package checks: (skipped)',
        options.push ? `- Push: ${options.remote} (commit + tag)` : '- Push: (skipped)',
        options.publish
          ? `- Publish package: npm publish${options.npmTag ? ` --tag ${options.npmTag}` : ''}`
          : '- Publish package: (skipped)',
        '',
        'Re-run with --apply to make changes.',
      ].join('\n') + '\n',
    );
    return;
  }

  pkg.version = nextVersion;
  await writePackageJson(pkgPath, pkg);

  const afterWriteStatus = await getGitStatusPorcelain(options.cwd);
  if (!afterWriteStatus.includes('package.json')) {
    throw new Error(
      'Expected package.json to be modified after version bump, but it was not detected by Git.',
    );
  }

  const addRes = await runGit(options.cwd, ['add', '--', 'package.json']);
  if (addRes.exitCode !== 0) throw new Error('git add failed.');

  const commitMessage = `chore(release): ${tag}`;
  const commitRes = await runGit(options.cwd, ['commit', '-m', commitMessage]);
  if (commitRes.exitCode !== 0) {
    throw new Error('git commit failed.');
  }

  const tagRes = await runGit(options.cwd, ['tag', '-a', tag, '-m', tag]);
  if (tagRes.exitCode !== 0) {
    throw new Error('git tag failed.');
  }

  if (options.push) {
    const pushCommit = await runGit(options.cwd, ['push', options.remote, 'HEAD'], {
      timeoutMs: GIT_NETWORK_TIMEOUT_MS,
    });
    if (pushCommit.exitCode !== 0) {
      throw new Error(`git push (commit) failed: ${formatGitFailure(pushCommit)}`);
    }

    const pushTag = await runGit(options.cwd, ['push', options.remote, tag], {
      timeoutMs: GIT_NETWORK_TIMEOUT_MS,
    });
    if (pushTag.exitCode !== 0) {
      throw new Error(`git push (tag) failed: ${formatGitFailure(pushTag)}`);
    }
  }

  if (options.publish) {
    await publishPackage({
      cwd: options.cwd,
      apply: true,
      tag: options.npmTag,
      otp: options.npmOtp,
      access: options.npmAccess,
    });
  }
}

function buildProgram(): Command {
  const program = new Command();

  program.name('release').description('Repository release helper (safe-by-default).');

  program
    .command('cut')
    .description(
      'Cut a release by bumping version, committing, tagging, and optionally pushing/dispatching.',
    )
    .addOption(
      new Option('--bump <type>', 'Bump version from package.json').choices([
        'patch',
        'minor',
        'major',
      ]),
    )
    .option('--version <x.y.z>', 'Set an explicit version instead of bumping')
    .option('--branch <name>', 'Expected current branch', 'main')
    .option('--remote <name>', 'Git remote to use for fetch/push', 'origin')
    .option('--no-fetch', 'Do not run git fetch before checks')
    .option('--allow-dirty', 'Allow cutting from a dirty workspace (not recommended)', false)
    .option('--skip-verify', 'Skip `bun run verify`', false)
    .option('--skip-build', 'Skip `bun run build`', false)
    .option('--skip-package-check', 'Skip npm pack and temporary-install smoke tests', false)
    .option('--apply', 'Apply changes (default is dry-run)', false)
    .option('--push', 'Push commit and tag to remote (requires --apply)', false)
    .option('--publish', 'Publish the package to npm after tagging (requires --apply)', false)
    .option('--npm-tag <name>', 'npm dist-tag to publish under (default: npm default)')
    .option('--npm-otp <code>', 'One-time password for npm 2FA')
    .option(
      '--npm-access <level>',
      'npm access level',
      (value) => {
        if (value !== 'public' && value !== 'restricted') {
          throw new Error('`--npm-access` must be either "public" or "restricted".');
        }
        return value;
      },
      'public',
    )
    .action(async (opts) => {
      await cutRelease({
        cwd: process.cwd(),
        branch: String(opts.branch),
        remote: String(opts.remote),
        fetch: Boolean(opts.fetch),
        allowDirty: Boolean(opts.allowDirty),
        bump: opts.bump as 'patch' | 'minor' | 'major' | undefined,
        version: opts.version ? String(opts.version) : undefined,
        verify: !opts.skipVerify,
        build: !opts.skipBuild,
        packageCheck: !opts.skipPackageCheck,
        apply: Boolean(opts.apply),
        push: Boolean(opts.push),
        publish: Boolean(opts.publish),
        npmTag: opts.npmTag ? String(opts.npmTag) : undefined,
        npmOtp: opts.npmOtp ? String(opts.npmOtp) : undefined,
        npmAccess: opts.npmAccess as 'public' | 'restricted',
      });
    });

  program
    .command('publish')
    .description('Publish the current package contents to npm.')
    .option('--tag <name>', 'npm dist-tag (default: npm default)')
    .option('--otp <code>', 'One-time password for npm 2FA')
    .option(
      '--access <level>',
      'npm access level',
      (value) => {
        if (value !== 'public' && value !== 'restricted') {
          throw new Error('`--access` must be either "public" or "restricted".');
        }
        return value;
      },
      'public',
    )
    .option('--apply', 'Actually publish (default is dry-run)', false)
    .action(async (opts) => {
      await publishPackage({
        cwd: process.cwd(),
        apply: Boolean(opts.apply),
        tag: opts.tag ? String(opts.tag) : undefined,
        otp: opts.otp ? String(opts.otp) : undefined,
        access: opts.access as 'public' | 'restricted',
      });
    });

  return program;
}

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
