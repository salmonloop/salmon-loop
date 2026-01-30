import { spawn } from 'child_process';

import { findFileDependencies } from '../../dependency.js';
import { LIMITS } from '../../limits.js';
import { normalizePath } from '../../path.js';
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
  return new Promise((resolve) => {
    const args = ['diff'];
    if (cached) args.push('--cached');
    if (files.length > 0) args.push('--', ...files);

    const child = spawn('git', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });

    let output = '';
    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0 && output.trim()) resolve(output);
      else resolve(undefined);
    });

    child.on('error', () => resolve(undefined));
  });
}

async function resolveDiffFiles(req: ContextRequest, scope: DiffScope): Promise<string[]> {
  if (!req.primaryFile) return [];
  if (scope === 'primary') return [req.primaryFile];

  const deps = await findFileDependencies(req.primaryFile, req.repoPath).catch(() => []);
  const all = uniqPaths([req.primaryFile, ...deps]).slice(0, LIMITS.maxRelatedFiles);
  return all;
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
