import { describe, it, expect } from 'bun:test';

import { rankContextForRelevance } from '../../../src/core/context/scoring/relevance.js';
import type { Context } from '../../../src/core/types/index.js';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    repoPath: '/repo',
    primaryFile: 'src/a.ts',
    primaryText: 'PRIMARY',
    rgSnippets: [],
    ...overrides,
  };
}

describe('Attention-weighted Relevance Ranking', () => {
  it('penalizes import depth in RepoMap', () => {
    const ctx = makeContext({
      repoMap: {
        nodes: [
          { path: 'src/a.ts', depth: 0, source: 'primary' },
          { path: 'src/near.ts', depth: 1, source: 'import' },
          { path: 'src/far.ts', depth: 2, source: 'import' },
        ],
        edges: [],
        maxDepth: 2,
        trigger: 'shallow',
      },
      relatedFiles: [
        { path: 'src/far.ts', content: 'F', kind: 'import', mode: 'full' },
        { path: 'src/near.ts', content: 'N', kind: 'import', mode: 'full' },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    expect(ranked.relatedFiles?.[0]?.path).toBe('src/near.ts');
    expect(ranked.relatedFiles?.[1]?.path).toBe('src/far.ts');
  });

  it('prioritizes files with symbol definitions in SymbolMap', () => {
    const ctx = makeContext({
      symbolMap: {
        nodes: [
          {
            id: 'd1',
            name: 'important',
            kind: 'definition',
            path: 'src/z_logic.ts',
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
          },
        ],
        edges: [],
      },
      relatedFiles: [
        { path: 'src/a_util.ts', content: 'U', kind: 'import', mode: 'full' },
        { path: 'src/z_logic.ts', content: 'L', kind: 'import', mode: 'full' },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    expect(ranked.relatedFiles?.[0]?.path).toBe('src/z_logic.ts');
  });
});
