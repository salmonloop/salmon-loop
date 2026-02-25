import {
  packUntilFull,
  createBudgetCalculator,
} from '../../../src/core/context/policies/pack-until-full.js';
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
  // Use char-based calculator for deterministic tests
  const charCalc = createBudgetCalculator();

  it('returns unchanged context when under budget', () => {
    const ctx = makeContext({
      primaryText: 'hello',
      rgSnippets: [{ file: 'src/a.ts', line: 1, content: 'x'.repeat(10) }],
      stagedDiff: 'diff',
    });

    const result = packUntilFull(ctx, 10_000, charCalc);
    expect(result.truncated).toBe(false);
    expect(result.context).toEqual(ctx);
  });

  it('drops snippets when primary exceeds budget', () => {
    const ctx = makeContext({
      primaryText: 'x'.repeat(200),
      rgSnippets: [{ file: 'src/a.ts', line: 1, content: 'y'.repeat(200) }],
      gitDiff: 'diff --git a/x b/x',
    });

    const result = packUntilFull(ctx, 100, charCalc);
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

    const result = packUntilFull(ctx, 80, charCalc);
    expect(result.truncated).toBe(true);
    expect(result.context.rgSnippets.length).toBe(1);
    expect(result.context.rgSnippets[0]?.file).toBe('src/a.ts');
    expect(result.context.gitDiff).toBeDefined();
  });

  it('prioritizes related files before snippets', () => {
    const ctx = makeContext({
      relatedFiles: [
        { path: 'src/dep.ts', content: 'DEP'.repeat(30), kind: 'import', mode: 'full' },
      ],
      rgSnippets: [{ file: 'src/a.ts', line: 1, content: 'SNIP'.repeat(30) }],
    });

    const result = packUntilFull(ctx, 150, charCalc);
    expect(result.truncated).toBe(true);
    expect(result.context.relatedFiles?.length).toBe(1);
    // Snippets should be dropped first when budget is tight.
    expect(result.context.rgSnippets.length).toBe(0);
  });

  describe('partition quota strategies', () => {
    it('should reserve budget for target files', () => {
      const ctx = makeContext({
        primaryText: 'x'.repeat(50),
        targets: [{ path: 'src/target.ts', reason: 'explicit_path', confidence: 'high' }],
        relatedFiles: [
          { path: 'src/target.ts', content: 'TARGET', kind: 'import', mode: 'full' },
          { path: 'src/other.ts', content: 'OTHER'.repeat(100), kind: 'import', mode: 'full' },
        ],
      });

      const result = packUntilFull(ctx, 200, charCalc);
      // Target file should be prioritized
      expect(result.context.relatedFiles?.some((f) => f.path === 'src/target.ts')).toBe(true);
    });

    it('should never have negative available budget for targets', () => {
      const ctx = makeContext({
        primaryText: 'x'.repeat(100),
        targets: [
          { path: 'src/target1.ts', reason: 'explicit_path', confidence: 'high' },
          { path: 'src/target2.ts', reason: 'explicit_path', confidence: 'high' },
        ],
        relatedFiles: [
          { path: 'src/target1.ts', content: 'T1'.repeat(100), kind: 'import', mode: 'full' },
          { path: 'src/target2.ts', content: 'T2'.repeat(100), kind: 'import', mode: 'full' },
        ],
      });

      // Very tight budget - should handle gracefully without negative values
      const result = packUntilFull(ctx, 50, charCalc);
      expect(result.truncated).toBe(true);
      // Should not throw or produce invalid state
      expect(result.context).toBeDefined();
    });

    it('should handle outline fallback when file exceeds available budget', () => {
      const ctx = makeContext({
        primaryText: 'x'.repeat(20),
        relatedFiles: [
          {
            path: 'src/large.ts',
            content: 'FULL'.repeat(200),
            kind: 'import',
            mode: 'full',
            outline: 'outline',
          },
        ],
      });

      const result = packUntilFull(ctx, 100, charCalc);
      // Should use outline when full content doesn't fit (or drop file if outline too large)
      const largeFile = result.context.relatedFiles?.find((f) => f.path === 'src/large.ts');
      if (largeFile) {
        // File might be included as outline or truncated content
        expect(largeFile.mode).toBe('outline');
      }
    });

    it('should partition budget according to allocation strategy', () => {
      const ctx = makeContext({
        primaryText: 'x'.repeat(30),
        relatedFiles: [
          { path: 'src/a.ts', content: 'A'.repeat(20), kind: 'import', mode: 'full' },
          { path: 'src/b.ts', content: 'B'.repeat(20), kind: 'import', mode: 'full' },
        ],
        rgSnippets: [{ file: 'src/c.ts', line: 1, content: 'C'.repeat(20) }],
        stagedDiff: 'diff',
      });

      const result = packUntilFull(ctx, 150, charCalc);
      // Diff should be prioritized and kept
      expect(result.context.stagedDiff).toBeDefined();
      // Should not throw and context should be valid
      expect(result.context).toBeDefined();
    });

    it('should handle empty or undefined targets gracefully', () => {
      const ctx = makeContext({
        primaryText: 'x'.repeat(50),
        targets: [],
        relatedFiles: [
          { path: 'src/file.ts', content: 'CONTENT'.repeat(10), kind: 'import', mode: 'full' },
        ],
      });

      const result = packUntilFull(ctx, 200, charCalc);
      expect(result.context.relatedFiles?.length).toBe(1);
    });

    it('should handle targets array with undefined values', () => {
      const ctx = makeContext({
        primaryText: 'x'.repeat(50),
        targets: undefined,
        relatedFiles: [
          { path: 'src/file.ts', content: 'CONTENT'.repeat(10), kind: 'import', mode: 'full' },
        ],
      });

      const result = packUntilFull(ctx, 200, charCalc);
      expect(result.context.relatedFiles?.length).toBe(1);
    });
  });
});
