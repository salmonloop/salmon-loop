import { readdir, readFile, writeFile, mkdir } from '../../adapters/fs/node-fs.js';
import { logger } from '../../observability/logger.js';
import type { ProjectTopology } from '../../types/context.js';
import { safeJoin } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

export class ArchitectureGatherer {
  private static readonly INDEX_DIR = '.salmonloop/index';
  private static readonly ARCH_FILE = 'architecture.json';

  async gather(req: ContextRequest): Promise<ProjectTopology> {
    const { repoPath } = req;
    const indexDir = safeJoin(repoPath, ArchitectureGatherer.INDEX_DIR);
    const archFile = safeJoin(indexDir, ArchitectureGatherer.ARCH_FILE);

    // Try reading from cache first
    try {
      const cached = await readFile(archFile, 'utf-8');
      const parsed = JSON.parse(cached);
      // Simple cache validation: if it has modules, use it
      if (parsed.modules && Array.isArray(parsed.modules)) {
        return parsed;
      }
    } catch {
      // Cache miss or corrupted, proceed to scan
    }

    const topology: ProjectTopology = {
      modules: [],
      folderStructure: '',
    };

    const srcPath = safeJoin(repoPath, 'src');
    try {
      const srcEntries = await readdir(srcPath, { withFileTypes: true });
      const moduleList: string[] = [];

      for (const entry of srcEntries) {
        if (entry.isDirectory()) {
          const name = entry.name;
          const role = this.estimateRole(name);
          topology.modules.push({
            name,
            path: `src/${name}`,
            estimatedRole: role,
          });
          moduleList.push(name);
        }
      }

      // Basic folder structure: tree-like overview
      topology.folderStructure = 'src/\n' + moduleList.map((m) => `  └── ${m}/`).join('\n');

      // Persistence: save to cache
      try {
        await mkdir(indexDir, { recursive: true });
        await writeFile(archFile, JSON.stringify(topology, null, 2));
      } catch (e) {
        logger.debug(`[ArchitectureGatherer] Failed to save cache: ${e}`);
      }
    } catch (e) {
      logger.debug(`[ArchitectureGatherer] Failed to scan src directory: ${e}`);
      // Fallback if no src directory
      return { modules: [] };
    }

    return topology;
  }

  private estimateRole(name: string): 'core' | 'adapter' | 'cli' | 'util' | 'other' {
    const lower = name.toLowerCase();
    if (lower.includes('core') || lower.includes('engine') || lower.includes('logic'))
      return 'core';
    if (lower.includes('adapter') || lower.includes('integration') || lower.includes('connector'))
      return 'adapter';
    if (lower.includes('cli') || lower.includes('commands') || lower.includes('interface'))
      return 'cli';
    if (lower.includes('util') || lower.includes('helper') || lower.includes('common'))
      return 'util';
    return 'other';
  }
}
