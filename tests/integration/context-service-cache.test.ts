import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ContextService } from '../../src/core/context/service.js';
import type { ContextRequest } from '../../src/core/context/types.js';

describe('ContextService cache (integration)', () => {
  it('invalidates cache when primary file content changes', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'context-cache-'));
    const primaryFile = 'src/a.ts';
    const absPrimaryFile = join(repoPath, primaryFile);
    await mkdir(join(repoPath, 'src'), { recursive: true });
    await writeFile(absPrimaryFile, 'export const value = 1;\n');

    let gatherCount = 0;
    const service = new ContextService({
      primaryTextGatherer: {
        gather: async () => {
          gatherCount++;
          return { primaryText: await Bun.file(absPrimaryFile).text() };
        },
      } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: [] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: { assemble: (_context: any) => ({ prompt: 'PROMPT' }) },
    });

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath,
      primaryFile,
    };

    await service.build(req);
    await writeFile(absPrimaryFile, 'export const value = 2;\n');
    await service.build(req);

    expect(gatherCount).toBe(2);
  });

  it('invalidates no-primary cache when git state signature changes', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'context-cache-noprimary-'));
    await mkdir(join(repoPath, '.git'), { recursive: true });
    await writeFile(join(repoPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(repoPath, '.git', 'index'), 'index-v1');

    let gatherCount = 0;
    const service = new ContextService({
      primaryTextGatherer: {
        gather: async () => {
          gatherCount++;
          return { primaryText: undefined };
        },
      } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: [] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: { assemble: () => ({ prompt: 'PROMPT' }) },
    });

    const req: ContextRequest = {
      instruction: 'help me improve this',
      repoPath,
    };

    await service.build(req);
    await writeFile(join(repoPath, '.git', 'index'), 'index-v2');
    await service.build(req);

    expect(gatherCount).toBe(2);
  });

  it('keeps no-primary cache hit when only unrelated noise files change', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'context-cache-noise-'));
    await mkdir(join(repoPath, '.git'), { recursive: true });
    await writeFile(join(repoPath, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(join(repoPath, '.git', 'index'), 'index-v1');

    let gatherCount = 0;
    const service = new ContextService({
      primaryTextGatherer: {
        gather: async () => {
          gatherCount++;
          return { primaryText: undefined };
        },
      } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: [] }) } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {}, relatedFiles: [] }),
      } as any,
      assembler: { assemble: () => ({ prompt: 'PROMPT' }) },
    });

    const req: ContextRequest = {
      instruction: 'help me improve this',
      repoPath,
    };

    await service.build(req);
    await writeFile(join(repoPath, 'noise.log'), `noise-${Date.now()}\n`);
    await service.build(req);

    expect(gatherCount).toBe(1);
  });
});
