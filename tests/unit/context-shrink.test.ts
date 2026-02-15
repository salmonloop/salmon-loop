import { ContextBuilder } from '../../src/core/context/builder.js';
import { ErrorType, Context } from '../../src/core/types/index.js';

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
});
