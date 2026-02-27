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

describe('Semantic Probe - Instruction Awareness', () => {
  it('prioritizes files matching instruction keywords in their path', () => {
    const ctx = makeContext({
      instruction: 'Fix authentication issue',
      relatedFiles: [
        { path: 'src/z_auth_service.ts', content: 'y', kind: 'import', mode: 'full' },
        { path: 'src/a_other.ts', content: 'x', kind: 'import', mode: 'full' },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    expect(ranked.relatedFiles?.[0]?.path).toBe('src/z_auth_service.ts');
  });

  it('prioritizes files matching instruction keywords in their symbols', () => {
    const ctx = makeContext({
      instruction: 'Update token validation',
      symbolMap: {
        nodes: [
          {
            id: 'd1',
            name: 'validateToken',
            kind: 'definition',
            path: 'src/z_crypto.ts',
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
          },
        ],
        edges: [],
      },
      relatedFiles: [
        { path: 'src/a_util.ts', content: 'U', kind: 'import', mode: 'full' },
        { path: 'src/z_crypto.ts', content: 'C', kind: 'import', mode: 'full' },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    expect(ranked.relatedFiles?.[0]?.path).toBe('src/z_crypto.ts');
  });
});

describe('Semantic Probe - Structural Heuristics', () => {
  it('prioritizes files with high call density from primary file', () => {
    const ctx = makeContext({
      primaryFile: 'src/main.ts',
      symbolMap: {
        nodes: [
          {
            id: 'ref1',
            name: 'call1',
            kind: 'reference',
            path: 'src/main.ts',
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
          },
          {
            id: 'ref2',
            name: 'call2',
            kind: 'reference',
            path: 'src/main.ts',
            location: { start: { line: 2, column: 1 }, end: { line: 2, column: 10 } },
          },
          {
            id: 'def1',
            name: 'call1',
            kind: 'definition',
            path: 'src/z_heavy.ts',
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
          },
          {
            id: 'def2',
            name: 'call2',
            kind: 'definition',
            path: 'src/z_heavy.ts',
            location: { start: { line: 2, column: 1 }, end: { line: 2, column: 10 } },
          },
          {
            id: 'def3',
            name: 'util1',
            kind: 'definition',
            path: 'src/a_light.ts',
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
          },
        ],
        edges: [
          { from: 'ref1', to: 'def1', type: 'call', confidence: 'high' },
          { from: 'ref2', to: 'def2', type: 'call', confidence: 'high' },
        ],
      },
      relatedFiles: [
        { path: 'src/a_light.ts', content: 'L', kind: 'import', mode: 'full' },
        { path: 'src/z_heavy.ts', content: 'H', kind: 'import', mode: 'full' },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    expect(ranked.relatedFiles?.[0]?.path).toBe('src/z_heavy.ts');
  });
});
