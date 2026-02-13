import { access } from 'fs/promises';
import path from 'path';

import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { LIMITS } from '../../config/limits.js';
import { logger } from '../../observability/logger.js';
import { normalizePath } from '../../utils/path.js';
import { findFileDependencies } from '../dependencies.js';
import type { ContextRequest, DiffScope } from '../types.js';

export interface GitDiffResult {
  stagedDiff?: string;
  unstagedDiff?: string;
  gitDiff?: string;
  includedFiles: string[];
}

function uniqPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const normalized = normalizePath(p).replace(/^(\.\/|\/)/, '');
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

async function runGitDiff(
  cwd: string,
  cached: boolean,
  files: string[],
): Promise<string | undefined> {
  const args = ['diff'];
  if (cached) args.push('--cached');
  if (files.length > 0) args.push('--', ...files);

  const git = new GitAdapter(cwd);
  const res = await git.execMeta(args, {
    cwd,
    limits: { maxStdoutBytes: LIMITS.maxToolOutputBytes, maxStderrChars: 16_384 },
    timeoutMs: LIMITS.gitTimeoutMs,
  });

  if (!res.ok) return undefined;
  if (res.stdoutTruncated) {
    logger.debug(
      `[GitDiffGatherer] git diff stdout truncated at ${LIMITS.maxToolOutputBytes} bytes (args=${args.join(
        ' ',
      )}); dropping diff for safety`,
    );
    return undefined;
  }

  const output = res.stdout.toString('utf8');
  return output.trim() ? output : undefined;
}

async function resolveDiffFiles(req: ContextRequest, scope: DiffScope): Promise<string[]> {
  if (!req.primaryFile) return [];
  if (scope === 'primary') return [req.primaryFile];

  const deps = await findFileDependencies(req.primaryFile, req.repoPath).catch(() => []);
  const all = uniqPaths([req.primaryFile, ...deps]).slice(0, LIMITS.maxRelatedFiles);
  return await resolveSourcePaths(req.repoPath, all);
}

async function resolveSourcePaths(repoPath: string, files: string[]): Promise<string[]> {
  const resolved: string[] = [];

  for (const file of files) {
    const normalized = normalizePath(file);
    const full = path.join(repoPath, normalized);

    if (await exists(full)) {
      resolved.push(normalized);
      continue;
    }

    const mapped = mapEsmImportPathToSource(normalized);
    if (mapped !== normalized && (await exists(path.join(repoPath, mapped)))) {
      resolved.push(mapped);
      continue;
    }

    resolved.push(normalized);
  }

  return uniqPaths(resolved);
}

function mapEsmImportPathToSource(filePath: string): string {
  if (filePath.endsWith('.js')) return filePath.replace(/\.js$/, '.ts');
  if (filePath.endsWith('.jsx')) return filePath.replace(/\.jsx$/, '.tsx');
  return filePath;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export class GitDiffGatherer {
  async gather(req: ContextRequest): Promise<GitDiffResult> {
    const scope: DiffScope = req.diffScope ?? 'primary';
    const files = await resolveDiffFiles(req, scope);

    const stagedDiff = await runGitDiff(req.repoPath, true, files);
    const unstagedDiff = await runGitDiff(req.repoPath, false, files);
    const gitDiff = [stagedDiff, unstagedDiff].filter(Boolean).join('\n').trim() || undefined;

    return { stagedDiff, unstagedDiff, gitDiff, includedFiles: files };
  }
}
