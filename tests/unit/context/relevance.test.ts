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

describe('rankContextForRelevance (targets)', () => {
  it('prioritizes target related files', () => {
    const ctx = makeContext({
      targets: [{ path: 'src/target.ts', reason: 'explicit_path', confidence: 'high' }],
      relatedFiles: [
        { path: 'src/other.ts', content: 'x', kind: 'import', mode: 'full' },
        { path: 'src/target.ts', content: 'y', kind: 'import', mode: 'full' },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    expect(ranked.relatedFiles?.[0]?.path).toBe('src/target.ts');
  });

  it('prioritizes snippets from target files', () => {
    const ctx = makeContext({
      targets: [{ path: 'src/target.ts', reason: 'explicit_path', confidence: 'high' }],
      rgSnippets: [
        { file: 'src/other.ts', line: 1, content: 'O' },
        { file: 'src/target.ts', line: 2, content: 'T' },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    expect(ranked.rgSnippets[0]?.file).toBe('src/target.ts');
  });
});
