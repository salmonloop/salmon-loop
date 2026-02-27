import { readdir, readFile, writeFile, unlink, mkdir } from '../../adapters/fs/node-fs.js';
import { getDefaultIndexPath } from '../../config/paths.js';
import { logger } from '../../observability/logger.js';
import type { ProjectKnowledge } from '../../types/context.js';
import { safeJoin } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

export class KnowledgeGatherer {
  private static readonly KNOWLEDGE_SUBDIR = 'knowledge';
  private static readonly SNAPSHOT_FILE = 'snapshot.json';
  private static readonly COMPACTION_THRESHOLD = 20; // Compact after 20 events

  async gather(req: ContextRequest): Promise<ProjectKnowledge> {
    const { repoPath } = req;
    const indexPath = getDefaultIndexPath(repoPath);
    const knowledgeDir = safeJoin(indexPath, KnowledgeGatherer.KNOWLEDGE_SUBDIR);

    const aggregated: ProjectKnowledge = {
      project_rules: undefined,
      architectural_decisions: [],
      user_preferences: undefined,
    };
    const allDeprecated = new Set<string>();

    try {
      const allFiles = await readdir(knowledgeDir);
      // Sort files by timestamp (ascending) to apply Last-Writer-Wins correctly
      // We process snapshot.json first if it exists, then all event files
      const eventFiles = allFiles
        .filter((f) => f.endsWith('.json') && f !== KnowledgeGatherer.SNAPSHOT_FILE)
        .sort();

      // 1. Load Snapshot if exists
      if (allFiles.includes(KnowledgeGatherer.SNAPSHOT_FILE)) {
        try {
          const snapshotContent = await readFile(
            safeJoin(knowledgeDir, KnowledgeGatherer.SNAPSHOT_FILE),
            'utf-8',
          );
          const snapshotData = JSON.parse(snapshotContent);
          Object.assign(aggregated, snapshotData);
          if (snapshotData.deprecated_rules) {
            snapshotData.deprecated_rules.forEach((r: string) => allDeprecated.add(r));
          }
        } catch (e) {
          logger.warn(`[KnowledgeGatherer] Failed to load snapshot: ${e}`);
        }
      }

      // 2. Load and Apply Events
      for (const file of eventFiles) {
        try {
          const content = await readFile(safeJoin(knowledgeDir, file), 'utf-8');
          const data = JSON.parse(content);

          if (data.project_rules) {
            aggregated.project_rules = data.project_rules;
          }
          if (data.deprecated_rules) {
            data.deprecated_rules.forEach((r: string) => allDeprecated.add(r));
          }
          if (data.architectural_decisions) {
            aggregated.architectural_decisions!.push(...data.architectural_decisions);
          }
          if (data.user_preferences) {
            aggregated.user_preferences = data.user_preferences;
          }
        } catch {
          // Skip corrupted files
        }
      }

      // Filter out deprecated rules from aggregated project_rules
      if (aggregated.project_rules) {
        aggregated.project_rules = aggregated.project_rules.filter((r) => !allDeprecated.has(r));
      }

      // 3. Optional Compaction
      if (eventFiles.length >= KnowledgeGatherer.COMPACTION_THRESHOLD) {
        // Run compaction in background (non-blocking)
        this.compact(knowledgeDir, aggregated, eventFiles).catch((e) =>
          logger.debug(`[KnowledgeGatherer] Compaction failed: ${e}`),
        );
      }
    } catch {
      // Directory missing or other read errors, return empty aggregated state
    }

    return {
      project_rules: aggregated.project_rules,
      architectural_decisions: aggregated.architectural_decisions?.length
        ? aggregated.architectural_decisions
        : undefined,
      user_preferences: aggregated.user_preferences,
    };
  }

  private async compact(
    knowledgeDir: string,
    aggregated: ProjectKnowledge,
    filesToMerge: string[],
  ): Promise<void> {
    logger.debug(`[KnowledgeGatherer] Compacting ${filesToMerge.length} knowledge events...`);

    const snapshotPath = safeJoin(knowledgeDir, KnowledgeGatherer.SNAPSHOT_FILE);

    try {
      await mkdir(knowledgeDir, { recursive: true });
      await writeFile(snapshotPath, JSON.stringify(aggregated, null, 2));

      // After successful snapshot write, delete merged event files
      for (const file of filesToMerge) {
        await unlink(safeJoin(knowledgeDir, file)).catch(() => {});
      }

      logger.info(`[KnowledgeGatherer] Compaction complete. Merged into ${snapshotPath}`);
    } catch (e) {
      throw new Error(`Failed to compact knowledge: ${e}`);
    }
  }
}
