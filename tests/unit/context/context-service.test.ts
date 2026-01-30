import { describe, it, expect } from 'vitest';

import { ContextService } from '../../../src/core/context/service';
import type { ContextRequest } from '../../../src/core/context/types';

describe('ContextService', () => {
  it('builds prompt and context with injected deps', async () => {
    const service = new ContextService({
      primaryTextGatherer: {
        gather: async () => ({ primaryText: 'PRIMARY' }),
      } as any,
      ripgrepGatherer: {
        searchMultipleKeywords: async () => [{ file: 'src/a.ts', line: 1, content: 'SNIP' }],
      } as any,
      gitDiffGatherer: {
        gather: async () => ({
          stagedDiff: 'STAGED',
          unstagedDiff: undefined,
          gitDiff: 'STAGED',
          includedFiles: ['src/a.ts'],
        }),
      } as any,
      astGatherer: {
        gather: async () => ({ symbols: [], definitionMap: {} }),
      } as any,
      assembler: {
        assemble: () => ({ prompt: 'PROMPT' }),
      },
    });

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
    };

    const result = await service.build(req);
    expect(result.prompt).toBe('PROMPT');
    expect(result.context.primaryText).toBe('PRIMARY');
    expect(result.context.rgSnippets.length).toBe(1);
    expect(result.meta.diffScope).toBe('primary');
    expect(result.meta.includedFiles).toEqual(['src/a.ts']);
    expect(result.meta.usedChars).toBeGreaterThan(0);
  });

  it('preserves requested diffScope in meta', async () => {
    const service = new ContextService({
      primaryTextGatherer: { gather: async () => ({ primaryText: 'PRIMARY' }) } as any,
      ripgrepGatherer: { searchMultipleKeywords: async () => [] } as any,
      gitDiffGatherer: { gather: async () => ({ includedFiles: [] }) } as any,
      astGatherer: { gather: async () => ({ symbols: [], definitionMap: {} }) } as any,
      assembler: { assemble: () => ({ prompt: 'PROMPT' }) },
    });

    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
      diffScope: 'ast_related',
    };

    const result = await service.build(req);
    expect(result.meta.diffScope).toBe('ast_related');
  });
});
