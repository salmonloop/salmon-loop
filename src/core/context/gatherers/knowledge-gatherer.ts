import { readFile } from '../../adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../config/paths.js';
import type { ProjectKnowledge } from '../../types/context.js';
import { safeJoin } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

export class KnowledgeGatherer {
  private static readonly KNOWLEDGE_FILE = 'knowledge.json';

  async gather(req: ContextRequest): Promise<ProjectKnowledge> {
    const { repoPath } = req;
    const indexPath = getDefaultIndexPath(repoPath);
    const knowledgeFile = safeJoin(indexPath, KnowledgeGatherer.KNOWLEDGE_FILE);

    try {
      const content = await readFile(knowledgeFile, 'utf-8');
      const parsed = JSON.parse(content);

      // Basic validation: ensure it has at least one of the expected fields
      if (parsed.project_rules || parsed.architectural_decisions || parsed.user_preferences) {
        return parsed;
      }
    } catch {
      // File not found or invalid JSON, return empty
    }

    return {};
  }
}
