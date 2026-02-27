import { packUntilFull } from '../../../src/core/context/policies/pack-until-full.js';
import { rankContextForRelevance } from '../../../src/core/context/scoring/relevance.js';
import type { Context } from '../../../src/core/types/index.js';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    repoPath: '/repo',
    primaryFile: 'src/a.ts',
    primaryText: 'x'.repeat(50),
    rgSnippets: [],
    ...overrides,
  };
}

describe('packUntilFull (targets)', () => {
  it('prioritizes target related files before non-target files', () => {
    const ctx = makeContext({
      targets: [{ path: 'src/target.ts', reason: 'explicit_path', confidence: 'high' }],
      relatedFiles: [
        { path: 'src/other.ts', content: 'O'.repeat(120), kind: 'import', mode: 'full' },
        { path: 'src/target.ts', content: 'T'.repeat(120), kind: 'import', mode: 'full' },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    const result = packUntilFull(ranked, 200);
    expect(result.truncated).toBe(true);
    expect(result.context.relatedFiles?.[0]?.path).toBe('src/target.ts');
  });

  it('prioritizes snippets from target files', () => {
    const ctx = makeContext({
      targets: [{ path: 'src/target.ts', reason: 'explicit_path', confidence: 'high' }],
      rgSnippets: [
        { file: 'src/other.ts', line: 1, content: 'O'.repeat(120) },
        { file: 'src/target.ts', line: 2, content: 'T'.repeat(120) },
      ],
    });

    const ranked = rankContextForRelevance(ctx);
    const result = packUntilFull(ranked, 200);
    expect(result.truncated).toBe(true);
    expect(result.context.rgSnippets[0]?.file).toBe('src/target.ts');
  });
});
