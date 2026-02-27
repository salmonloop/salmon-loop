import { GitAdapter } from '../../adapters/git/git-adapter.js';
import { normalizePath } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

export interface GitHistory {
  recentCommits?: string;
  churnByFile?: Record<string, number>;
}

function buildChurnIndex(logOutput: string): Record<string, number> {
  const churn: Record<string, number> = {};
  for (const rawLine of logOutput.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const normalized = normalizePath(line).replace(/^(\.\/|\/)+/, '');
    if (!normalized) continue;
    churn[normalized] = (churn[normalized] ?? 0) + 1;
  }
  return churn;
}

export class GitHistoryGatherer {
  async gather(req: ContextRequest): Promise<GitHistory> {
    const { repoPath } = req;
    try {
      const git = new GitAdapter(repoPath);
      // Use GitAdapter's query method for standard git commands
      const stdout = await git.query(['log', '-n', '5', '--oneline']);
      const churnLog = await git.query(['log', '-n', '40', '--name-only', '--pretty=format:']);
      return {
        recentCommits: stdout.trim(),
        churnByFile: buildChurnIndex(churnLog),
      };
    } catch {
      // Not a git repo or git not found
      return {};
    }
  }
}
