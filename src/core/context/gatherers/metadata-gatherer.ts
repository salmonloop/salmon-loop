import { FileAdapter } from '../../adapters/fs/file-adapter.js';
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
    } catch {
      // Ignored
    }

    // 2. README.md (first 1000 chars)
    try {
      const readmeRaw = await this.fileAdapter.readFile(safeJoin(repoPath, 'README.md'), 'utf-8');
      metadata.readmeHeader = readmeRaw.slice(0, 1000);
    } catch {
      // Ignored
    }

    // 3. AI Instructions (GEMINI.md, CLAUDE.md, ARCH.md)
    const aiFiles = ['GEMINI.md', 'CLAUDE.md', 'ARCH.md', '.gemini/ARCH.md'];
    const aiChunks = this.chunkArray(aiFiles, 10);
    for (const chunk of aiChunks) {
      const results = await Promise.all(
        chunk.map(async (file) => {
          try {
            const content = await this.fileAdapter.readFile(safeJoin(repoPath, file), 'utf-8');
            return { file, content };
          } catch {
            return null;
          }
        })
      );
      for (const res of results) {
        if (res) {
          metadata.aiInstructions = (metadata.aiInstructions || '') + `\n--- ${res.file} ---\n${res.content}`;
        }
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
    const configChunks = this.chunkArray(commonConfigs, 10);
    for (const chunk of configChunks) {
      const results = await Promise.all(
        chunk.map(async (config) => {
          try {
            await this.fileAdapter.readFile(safeJoin(repoPath, config), 'utf-8');
            return config;
          } catch {
            return null;
          }
        })
      );
      for (const res of results) {
        if (res) {
          metadata.configFiles.push(res);
        }
      }
    }

    return metadata;
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunked: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunked.push(array.slice(i, i + size));
    }
    return chunked;
  }
}
