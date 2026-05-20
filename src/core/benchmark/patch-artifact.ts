import { createHash } from 'crypto';
import { EOL } from 'os';
import path from 'path';

import { FileAdapter } from '../adapters/fs/file-adapter.js';
import { GitAdapter } from '../adapters/git/git-adapter.js';
import { LIMITS } from '../config/limits.js';
import { isPathWithinDirectory, isSafeRelativePath, normalizePath } from '../utils/path.js';

export interface BenchmarkPatchArtifact {
  patch: string;
  sha256: string;
  bytes: number;
  changedFiles: string[];
  isEmpty: boolean;
}

export class BenchmarkPatchArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchmarkPatchArtifactError';
  }
}

const DIFF_ARGS = [
  'diff',
  '--binary',
  '--no-color',
  '--no-ext-diff',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  'HEAD',
  '--',
  '.',
] as const;

function normalizeGitPatch(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n+$/, '');
  return normalized.length > 0 ? `${normalized}\n` : '';
}

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function buildUntrackedFilePatch(params: {
  repoPath: string;
  git: GitAdapter;
  relativePath: string;
}): Promise<string> {
  if (!isSafeRelativePath(params.relativePath) || params.relativePath.startsWith('.salmonloop/')) {
    throw new BenchmarkPatchArtifactError(`Unsafe untracked patch path: ${params.relativePath}`);
  }
  const result = await params.git.diffUntrackedFileAgainstNull(params.relativePath, {
    cwd: params.repoPath,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes },
  });
  if (result.code !== 0 && result.code !== 1) {
    throw new BenchmarkPatchArtifactError(result.stderr || 'Failed to diff untracked file.');
  }
  return normalizeGitPatch(result.stdout.toString('utf8'));
}

function parseChangedFilesFromPatch(patch: string): string[] {
  const files = new Set<string>();
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (!match) continue;
    const next = match[2];
    if (next !== '/dev/null') files.add(next);
  }
  return Array.from(files).sort();
}

export async function buildBenchmarkPatchArtifact(params: {
  repoPath: string;
  changedFilesHint?: readonly string[];
  excludePaths?: readonly string[];
}): Promise<BenchmarkPatchArtifact> {
  const git = new GitAdapter(params.repoPath);
  const fileAdapter = new FileAdapter();
  const excluded = await resolveRepoRelativeExcludes(params.repoPath, params.excludePaths ?? []);
  const pathspecs = buildPatchPathspecs(excluded);
  const trackedPatch = normalizeGitPatch(
    await git.query([...DIFF_ARGS, ...pathspecs], {
      trim: false,
      limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes },
    }),
  );

  const candidateUntracked = new Set<string>([
    ...splitLines(await git.query(['ls-files', '--others', '--exclude-standard'])),
    ...(params.changedFilesHint ?? []),
  ]);
  const untrackedPatches: string[] = [];
  for (const relativePath of Array.from(candidateUntracked).sort()) {
    const normalizedPath = normalizePath(relativePath);
    if (!normalizedPath || normalizedPath.startsWith('.salmonloop/')) continue;
    if (excluded.has(normalizedPath)) continue;
    const status = await git.getStatusForPath(normalizedPath);
    if (!status?.untracked) continue;
    if (!(await fileAdapter.exists(path.join(params.repoPath, normalizedPath)))) continue;
    untrackedPatches.push(
      await buildUntrackedFilePatch({
        repoPath: params.repoPath,
        git,
        relativePath: normalizedPath,
      }),
    );
  }

  const patch = normalizeGitPatch([trackedPatch, ...untrackedPatches].filter(Boolean).join(EOL));
  const bytes = Buffer.byteLength(patch, 'utf8');
  return {
    patch,
    bytes,
    sha256: createHash('sha256').update(patch, 'utf8').digest('hex'),
    changedFiles: parseChangedFilesFromPatch(patch),
    isEmpty: patch.length === 0,
  };
}

function buildPatchPathspecs(excluded: Set<string>): string[] {
  return Array.from(excluded)
    .sort()
    .map((relativePath) => `:(top,literal,exclude)${relativePath}`);
}

async function resolveRepoRelativeExcludes(
  repoPath: string,
  paths: readonly string[],
): Promise<Set<string>> {
  const resolvedRepoPath = path.resolve(repoPath);
  const excluded = new Set<string>();

  for (const candidate of paths) {
    if (!candidate) continue;
    const absolutePath = path.isAbsolute(candidate)
      ? path.resolve(candidate)
      : path.resolve(resolvedRepoPath, candidate);
    const relativePath = normalizePath(path.relative(resolvedRepoPath, absolutePath));
    if (!isSafeRelativePath(relativePath)) continue;
    if (!isPathWithinDirectory(resolvedRepoPath, absolutePath)) continue;
    excluded.add(relativePath);
  }

  return excluded;
}
