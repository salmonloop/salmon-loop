import { LIMITS } from '../../src/core/config/limits.js';
import { ContextBuilder } from '../../src/core/context/builder.js';
import { applySmartCompression } from '../../src/core/context/compression/smart-compress.js';
import {
  buildContextBudgetPolicyPlan,
  executeContextBudgetPolicyPlan,
} from '../../src/core/context/policies/budget-policy.js';
import { packUntilFull } from '../../src/core/context/policies/pack-until-full.js';
import { rankContextForRelevance } from '../../src/core/context/scoring/relevance.js';
import { calculateSectionChars } from '../../src/core/context/service-helpers.js';
import { ErrorType, Context } from '../../src/core/types/index.js';

function tuneAndPackMaxBudget(context: Context): Context {
  const budgetChars = LIMITS.maxContextChars;
  const compressed = applySmartCompression(context, { budgetChars });
  const ranked = rankContextForRelevance(compressed);
  const preBudgetSectionChars = calculateSectionChars(ranked);
  const plan = buildContextBudgetPolicyPlan({
    requestedBudgetChars: budgetChars,
    preBudgetSectionChars,
    targetCount: (ranked.targets ?? []).length,
  });
  return executeContextBudgetPolicyPlan({
    plan,
    context: ranked,
    fallbackBudgetChars: budgetChars,
    pack: packUntilFull,
  }).context;
}

describe('ContextBuilder.shrinkContext', () => {
  const mockContext: Context = {
    repoPath: '.',
    // Make primaryText large enough to exceed minContextChars protection
    primaryText: 'A'.repeat(6000),
    rgSnippets: [
      { file: 'src/a.ts', line: 1, content: 'content a' },
      { file: 'src/b.ts', line: 1, content: 'content b' },
      { file: 'tests/a.test.ts', line: 1, content: 'test content a' },
    ],
    gitDiff: 'some diff',
  };

  it('should shrink to failed files regardless of error type', async () => {
    const failedFiles = ['src/a.ts'];
    const result = await ContextBuilder.shrinkContext(
      mockContext,
      failedFiles,
      ErrorType.COMPILATION,
    );

    expect(result.rgSnippets).toHaveLength(1);
    expect(result.rgSnippets[0].file).toBe('src/a.ts');
    expect(result.targets?.some((t) => t.path === 'src/a.ts' && t.reason === 'failed_file')).toBe(
      true,
    );

    const result2 = await ContextBuilder.shrinkContext(mockContext, failedFiles, ErrorType.LOGIC);
    expect(result2.rgSnippets).toHaveLength(1);
    expect(result2.rgSnippets[0].file).toBe('src/a.ts');
    expect(result2.targets?.some((t) => t.path === 'src/a.ts' && t.reason === 'failed_file')).toBe(
      true,
    );
  });

  it('should return original context if no failed files', async () => {
    const result = await ContextBuilder.shrinkContext(mockContext, []);
    expect(result.rgSnippets).toHaveLength(3);
  });

  it('should be equivalent to tune+pack chain when no failed files', async () => {
    const input: Context = {
      ...mockContext,
      primaryFile: 'src/a.ts',
      relatedFiles: [
        {
          path: 'src/rel.ts',
          kind: 'dependency',
          mode: 'full',
          content: 'x'.repeat(40_000),
        },
      ],
      stagedDiff: 'diff --git a/src/a.ts b/src/a.ts\n'.repeat(2000),
      unstagedDiff: 'diff --git a/src/b.ts b/src/b.ts\n'.repeat(2000),
      gitDiff: undefined,
      targets: [{ path: 'src/a.ts', reason: 'primary', confidence: 'high' }],
    };

    const expected = tuneAndPackMaxBudget(input);
    const actual = await ContextBuilder.shrinkContext(input, []);
    expect(actual).toEqual(expected);
  });
});
