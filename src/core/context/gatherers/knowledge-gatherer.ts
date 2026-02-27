import { readdir, readFile } from '../../adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../config/paths.js';
import type { ProjectKnowledge } from '../../types/context.js';
import { safeJoin } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

export class KnowledgeGatherer {
  private static readonly KNOWLEDGE_SUBDIR = 'knowledge';

  async gather(req: ContextRequest): Promise<ProjectKnowledge> {
    const { repoPath } = req;
    const indexPath = getDefaultIndexPath(repoPath);
    const knowledgeDir = safeJoin(indexPath, KnowledgeGatherer.KNOWLEDGE_SUBDIR);

    const aggregated: ProjectKnowledge = {
      project_rules: undefined,
      architectural_decisions: [],
      user_preferences: undefined,
    };

    try {
      const files = await readdir(knowledgeDir);
      // Sort files by timestamp (ascending) to apply Last-Writer-Wins correctly
      const sortedFiles = files.filter((f) => f.endsWith('.json')).sort();

      for (const file of sortedFiles) {
        try {
          const content = await readFile(safeJoin(knowledgeDir, file), 'utf-8');
          const data = JSON.parse(content);

          // Category-based aggregation
          if (data.project_rules) {
            // Last-Writer-Wins: newer file overwrites previous rules
            aggregated.project_rules = data.project_rules;
          }

          if (data.architectural_decisions) {
            // Union: collect all decisions
            aggregated.architectural_decisions!.push(...data.architectural_decisions);
          }

          if (data.user_preferences) {
            // Last-Writer-Wins
            aggregated.user_preferences = data.user_preferences;
          }
        } catch {
          // Skip corrupted files
        }
      }
    } catch {
      // Directory missing or other read errors, return empty aggregated state
    }

    // Return undefined for optional fields if no data found
    return {
      project_rules: aggregated.project_rules,
      architectural_decisions: aggregated.architectural_decisions?.length
        ? aggregated.architectural_decisions
        : undefined,
      user_preferences: aggregated.user_preferences,
    };
  }
}
