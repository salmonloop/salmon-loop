import { GitAdapter } from '../../../adapters/git/git-adapter.js';

export interface CheckPatchAppliesArgs {
  repoRoot: string;
  diff: string;
}

interface CheckPatchAppliesDeps {
  createGitAdapter?: (repoRoot: string) => Pick<GitAdapter, 'execMeta'>;
}

export async function checkPatchApplies(args: CheckPatchAppliesArgs, deps?: CheckPatchAppliesDeps) {
  const git = deps?.createGitAdapter?.(args.repoRoot) ?? new GitAdapter(args.repoRoot);
  return git.execMeta(
    ['apply', '--check', '--recount', '--ignore-whitespace', '--whitespace=nowarn', '-'],
    {
      input: Buffer.from(args.diff, 'utf8'),
      timeoutMs: 15000,
      limits: { maxStdoutBytes: 0, maxStderrChars: 4000 },
    },
  );
}
