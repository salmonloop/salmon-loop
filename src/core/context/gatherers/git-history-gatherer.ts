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

function buildChurnIndexFromNumstat(logOutput: string): Record<string, number> {
  const churn: Record<string, number> = {};
  for (const rawLine of logOutput.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+|-)\s+(\d+|-)\s+(.+)$/);
    if (!match) continue;

    const added = match[1] === '-' ? 0 : Number(match[1]);
    const deleted = match[2] === '-' ? 0 : Number(match[2]);
    const filePath = normalizePath(match[3] ?? '').replace(/^(\.\/|\/)+/, '');
    if (!filePath) continue;
    churn[filePath] = (churn[filePath] ?? 0) + added + deleted;
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
      const churnNumstatLog = await git
        .query(['log', '-n', '40', '--numstat', '--pretty=format:'])
        .catch(() => '');
      const churnLog = await git.query(['log', '-n', '40', '--name-only', '--pretty=format:']);
      const churnByNumstat = buildChurnIndexFromNumstat(churnNumstatLog);

      return {
        recentCommits: stdout.trim(),
        churnByFile:
          Object.keys(churnByNumstat).length > 0 ? churnByNumstat : buildChurnIndex(churnLog),
      };
    } catch {
      // Not a git repo or git not found
      return {};
    }
  }
}
