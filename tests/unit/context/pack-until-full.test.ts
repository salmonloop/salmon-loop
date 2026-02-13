import { packUntilFull } from '../../../src/core/context/policies/pack-until-full.js';
import type { Context } from '../../../src/core/types/index.js';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    repoPath: '/repo',
    primaryFile: 'src/a.ts',
    primaryText: '0123456789',
    rgSnippets: [],
    ...overrides,
  };
}

describe('packUntilFull', () => {
  it('returns unchanged context when under budget', () => {
    const ctx = makeContext({
      primaryText: 'hello',
      rgSnippets: [{ file: 'src/a.ts', line: 1, content: 'x'.repeat(10) }],
      stagedDiff: 'diff',
    });

    const result = packUntilFull(ctx, 10_000);
    expect(result.truncated).toBe(false);
    expect(result.context).toEqual(ctx);
  });

  it('drops snippets when primary exceeds budget', () => {
    const ctx = makeContext({
      primaryText: 'x'.repeat(200),
      rgSnippets: [{ file: 'src/a.ts', line: 1, content: 'y'.repeat(200) }],
      gitDiff: 'diff --git a/x b/x',
    });

    const result = packUntilFull(ctx, 100);
    expect(result.truncated).toBe(true);
    expect(result.context.rgSnippets).toEqual([]);
    expect(result.context.gitDiff).toBeUndefined();
  });

  it('packs snippets until budget reached', () => {
    const ctx = makeContext({
      primaryText: 'x'.repeat(10),
      rgSnippets: [
        { file: 'src/a.ts', line: 1, content: 'a'.repeat(20) },
        { file: 'src/b.ts', line: 2, content: 'b'.repeat(200) },
      ],
      gitDiff: 'diff --git a/x b/x',
    });

    const result = packUntilFull(ctx, 80);
    expect(result.truncated).toBe(true);
    expect(result.context.rgSnippets.length).toBe(1);
    expect(result.context.rgSnippets[0]?.file).toBe('src/a.ts');
    expect(result.context.gitDiff).toBeUndefined();
  });

  it('prioritizes related files before snippets', () => {
    const ctx = makeContext({
      relatedFiles: [
        { path: 'src/dep.ts', content: 'DEP'.repeat(30), kind: 'import', mode: 'full' },
      ],
      rgSnippets: [{ file: 'src/a.ts', line: 1, content: 'SNIP'.repeat(30) }],
    });

    const result = packUntilFull(ctx, 150);
    expect(result.truncated).toBe(true);
    expect(result.context.relatedFiles?.length).toBe(1);
    // Snippets should be dropped first when budget is tight.
    expect(result.context.rgSnippets.length).toBe(0);
  });
});
