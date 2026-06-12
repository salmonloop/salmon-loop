import { FileAdapter } from '../../adapters/fs/file-adapter.js';
import { getLogger } from '../../observability/logger.js';
import { safeJoin } from '../../utils/path.js';
import type { ContextRequest } from '../types.js';

export interface ProjectMetadata {
  packageJson?: {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  readmeHeader?: string;
  configFiles?: string[];
  aiInstructions?: string;
}

export class MetadataGatherer {
  private readonly fileAdapter = new FileAdapter();

  async gather(req: ContextRequest): Promise<ProjectMetadata> {
    const { repoPath } = req;
    const metadata: ProjectMetadata = {};

    // 1. package.json
    try {
      const pkgRaw = await this.fileAdapter.readFile(safeJoin(repoPath, 'package.json'), 'utf-8');
      metadata.packageJson = JSON.parse(pkgRaw);
    } catch (error) {
      // Ignored - best-effort metadata
      getLogger().debug(
        `[MetadataGatherer] package.json read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 2. README.md (first 1000 chars)
    try {
      const readmeRaw = await this.fileAdapter.readFile(safeJoin(repoPath, 'README.md'), 'utf-8');
      metadata.readmeHeader = readmeRaw.slice(0, 1000);
    } catch (error) {
      // Ignored - best-effort metadata
      getLogger().debug(
        `[MetadataGatherer] README.md read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 3. AI Instructions (GEMINI.md, CLAUDE.md, ARCH.md)
    const aiFiles = ['GEMINI.md', 'CLAUDE.md', 'ARCH.md', '.gemini/ARCH.md'];
    for (const file of aiFiles) {
      try {
        const content = await this.fileAdapter.readFile(safeJoin(repoPath, file), 'utf-8');
        metadata.aiInstructions = (metadata.aiInstructions || '') + `\n--- ${file} ---\n${content}`;
      } catch (error) {
        // Ignored - best-effort metadata
        getLogger().debug(
          `[MetadataGatherer] AI instruction file ${file} not found: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // 4. List common config files
    const commonConfigs = [
      'package.json',
      'tsconfig.json',
      'eslint.config.js',
      '.prettierrc',
      '.oxfmtrc.json',
      'vitest.config.ts',
      'jest.config.js',
      'bun.lock',
      'pnpm-lock.yaml',
    ];

    metadata.configFiles = [];
    for (const config of commonConfigs) {
      try {
        await this.fileAdapter.readFile(safeJoin(repoPath, config), 'utf-8');
        metadata.configFiles.push(config);
      } catch (error) {
        // Ignored: config not found
        getLogger().debug(
          `[MetadataGatherer] config file ${config} not found: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return metadata;
  }
}
