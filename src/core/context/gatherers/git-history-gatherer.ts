import { GitAdapter } from '../../adapters/git/git-adapter.js';
import type { ContextRequest } from '../types.js';

export interface GitHistory {
  recentCommits?: string;
}

export class GitHistoryGatherer {
  async gather(req: ContextRequest): Promise<GitHistory> {
    const { repoPath } = req;
    try {
      const git = new GitAdapter(repoPath);
      // Use GitAdapter's query method for standard git commands
      const stdout = await git.query(['log', '-n', '5', '--oneline']);
      return { recentCommits: stdout.trim() };
    } catch {
      // Not a git repo or git not found
      return {};
    }
  }
}
