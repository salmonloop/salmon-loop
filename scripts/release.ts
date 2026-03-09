import { readFile, writeFile } from 'fs/promises';

import { Command, Option } from 'commander';
import { execa } from 'execa';

type Semver = {
  major: number;
  minor: number;
  patch: number;
  raw: string;
};

type GitRepoRef = {
  owner: string;
  repo: string;
};

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

async function assertGitRepo(cwd: string): Promise<void> {
  const res = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
  if (res.exitCode !== 0 || res.stdout.trim() !== 'true') {
    throw new Error('Not inside a Git work tree.');
  }
}

async function getGitBranch(cwd: string): Promise<string> {
  const res = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
  if (res.exitCode !== 0) {
    throw new Error((res.stderr || '').trim() || 'Failed to determine current Git branch.');
  }
  return res.stdout.trim();
}

async function getGitStatusPorcelain(cwd: string): Promise<string> {
  const res = await run('git', ['status', '--porcelain=v1'], { cwd });
  if (res.exitCode !== 0) {
    throw new Error((res.stderr || '').trim() || 'Failed to read Git status.');
  }
  return res.stdout.trim();
}

async function gitFetch(cwd: string, remote: string): Promise<void> {
  const res = await run('git', ['fetch', '--prune', remote], { cwd, stdio: 'inherit' });
  if (res.exitCode !== 0) {
    throw new Error('git fetch failed.');
  }
}

async function assertUpToDateWithUpstream(cwd: string): Promise<void> {
  const res = await run(
    'git',
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd },
  );
  if (res.exitCode !== 0) {
    // No upstream configured: do not block releasing.
    return;
  }
  const upstream = res.stdout.trim();
  if (!upstream) return;

  const counts = await run('git', ['rev-list', '--left-right', '--count', `${upstream}...HEAD`], {
    cwd,
  });
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
  const res = await run('git', ['tag', '--list', tag], { cwd });
  if (res.exitCode !== 0) {
    throw new Error((res.stderr || '').trim() || 'Failed to check Git tags.');
  }
  if (res.stdout.trim() === tag) {
    throw new Error(`Tag "${tag}" already exists.`);
  }
}

async function readPackageJson(cwd: string): Promise<{ path: string; json: any }> {
  const pkgPath = `${cwd.replace(/\\+$/g, '')}\\package.json`;
  const content = await readFile(pkgPath, 'utf-8');
  const json = JSON.parse(content) as any;
  return { path: pkgPath, json };
}

async function writePackageJson(pkgPath: string, json: unknown): Promise<void> {
  const content = `${JSON.stringify(json, null, 2)}\n`;
  await writeFile(pkgPath, content, 'utf-8');
}

function parseGitHubRepoFromRemote(remoteUrl: string): GitRepoRef | null {
  const url = remoteUrl.trim();

  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(url);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(url);
  if (https) return { owner: https[1], repo: https[2] };

  return null;
}

async function getOriginRepo(cwd: string, remote: string): Promise<GitRepoRef | null> {
  const res = await run('git', ['remote', 'get-url', remote], { cwd });
  if (res.exitCode !== 0) return null;
  return parseGitHubRepoFromRemote(res.stdout);
}

async function hasGhCli(): Promise<boolean> {
  const res = await run('gh', ['--version'], { stdio: 'pipe' });
  return res.exitCode === 0;
}

async function dispatchReleaseWorkflow(options: {
  cwd: string;
  remote: string;
  repo?: string;
  workflow: string;
  tag: string;
  ref: string;
  apply: boolean;
}): Promise<void> {
  const repoRef =
    options.repo?.includes('/') === true
      ? { owner: options.repo.split('/')[0]!, repo: options.repo.split('/')[1]! }
      : await getOriginRepo(options.cwd, options.remote);

  const repoArg = repoRef ? `${repoRef.owner}/${repoRef.repo}` : undefined;

  if (!(await hasGhCli())) {
    const repoHint = repoArg ? ` --repo ${repoArg}` : '';
    throw new Error(
      [
        'GitHub CLI (gh) is not available in PATH.',
        'Install it, or dispatch the workflow manually:',
        `  gh workflow run "${options.workflow}"${repoHint} --ref ${options.ref} -f tag=${options.tag}`,
      ].join('\n'),
    );
  }

  const args = [
    'workflow',
    'run',
    options.workflow,
    '--ref',
    options.ref,
    '-f',
    `tag=${options.tag}`,
  ];
  if (repoArg) args.push('--repo', repoArg);

  if (!options.apply) {
    process.stdout.write(`[dry-run] gh ${args.join(' ')}\n`);
    return;
  }

  const res = await run('gh', args, { cwd: options.cwd, stdio: 'inherit' });
  if (res.exitCode !== 0) {
    throw new Error('Failed to dispatch GitHub Actions workflow.');
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
  dispatch: boolean;
  workflow: string;
  repo?: string;
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

  if (!options.apply) {
    process.stdout.write(
      [
        '[dry-run] Planned actions:',
        `- Update package.json version: ${currentVersion.raw} -> ${nextVersion}`,
        `- Commit: chore(release): ${tag}`,
        `- Tag: ${tag}`,
        options.push ? `- Push: ${options.remote} (commit + tag)` : '- Push: (skipped)',
        options.dispatch
          ? `- Dispatch workflow: "${options.workflow}" (input tag=${tag})`
          : '- Dispatch workflow: (skipped)',
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

  const addRes = await run('git', ['add', '--', 'package.json'], {
    cwd: options.cwd,
    stdio: 'inherit',
  });
  if (addRes.exitCode !== 0) throw new Error('git add failed.');

  const commitMessage = `chore(release): ${tag}`;
  const commitRes = await run('git', ['commit', '-m', commitMessage], {
    cwd: options.cwd,
    stdio: 'inherit',
  });
  if (commitRes.exitCode !== 0) {
    throw new Error('git commit failed.');
  }

  const tagRes = await run('git', ['tag', '-a', tag, '-m', tag], {
    cwd: options.cwd,
    stdio: 'inherit',
  });
  if (tagRes.exitCode !== 0) {
    throw new Error('git tag failed.');
  }

  if (options.push) {
    const pushCommit = await run('git', ['push', options.remote, 'HEAD'], {
      cwd: options.cwd,
      stdio: 'inherit',
    });
    if (pushCommit.exitCode !== 0) throw new Error('git push (commit) failed.');

    const pushTag = await run('git', ['push', options.remote, tag], {
      cwd: options.cwd,
      stdio: 'inherit',
    });
    if (pushTag.exitCode !== 0) throw new Error('git push (tag) failed.');
  }

  if (options.dispatch) {
    await dispatchReleaseWorkflow({
      cwd: options.cwd,
      remote: options.remote,
      repo: options.repo,
      workflow: options.workflow,
      tag,
      ref: options.branch,
      apply: true,
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
    .option('--apply', 'Apply changes (default is dry-run)', false)
    .option('--push', 'Push commit and tag to remote (requires --apply)', false)
    .option(
      '--dispatch',
      'Dispatch the GitHub Actions compiled-binary workflow (requires --apply)',
      false,
    )
    .option('--workflow <name>', 'Workflow name or file', 'Release (compiled binaries)')
    .option(
      '--repo <owner/repo>',
      'GitHub repo for dispatch (defaults to origin remote when possible)',
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
        apply: Boolean(opts.apply),
        push: Boolean(opts.push),
        dispatch: Boolean(opts.dispatch),
        workflow: String(opts.workflow),
        repo: opts.repo ? String(opts.repo) : undefined,
      });
    });

  program
    .command('dispatch')
    .description(
      'Dispatch the GitHub Actions compiled-binary release workflow for an existing tag.',
    )
    .requiredOption('--tag <vX.Y.Z>', 'Release tag (e.g. v0.2.1)')
    .option('--branch <name>', 'Git ref for workflow dispatch', 'main')
    .option('--remote <name>', 'Git remote used to infer GitHub repo (optional)', 'origin')
    .option('--workflow <name>', 'Workflow name or file', 'Release (compiled binaries)')
    .option(
      '--repo <owner/repo>',
      'GitHub repo for dispatch (defaults to origin remote when possible)',
    )
    .option('--apply', 'Actually dispatch (default is dry-run)', false)
    .action(async (opts) => {
      await dispatchReleaseWorkflow({
        cwd: process.cwd(),
        remote: String(opts.remote),
        repo: opts.repo ? String(opts.repo) : undefined,
        workflow: String(opts.workflow),
        tag: String(opts.tag),
        ref: String(opts.branch),
        apply: Boolean(opts.apply),
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
