import { describe, it, expect } from 'vitest';
import { ContextBuilder } from '../../src/core/context.js';
import { ErrorType, Context } from '../../src/core/types.js';
import { LIMITS } from '../../src/core/limits.js';

describe('ContextBuilder.shrinkContext', () => {
  const mockContext: Context = {
    repoPath: '.',
    primaryText: 'primary content',
    rgSnippets: [
      { file: 'src/a.ts', line: 1, content: 'content a' },
      { file: 'src/b.ts', line: 1, content: 'content b' },
      { file: 'tests/a.test.ts', line: 1, content: 'test content a' }
    ],
    gitDiff: 'some diff'
  };

  it('should shrink strictly for compilation errors', async () => {
    const failedFiles = ['src/a.ts'];
    const result = await ContextBuilder.shrinkContext(mockContext, failedFiles, ErrorType.COMPILATION);
    
    expect(result.rgSnippets).toHaveLength(1);
    expect(result.rgSnippets[0].file).toBe('src/a.ts');
  });

  it('should keep neighbors for logic errors', async () => {
    const failedFiles = ['src/a.ts'];
    const result = await ContextBuilder.shrinkContext(mockContext, failedFiles, ErrorType.LOGIC);
    
    // Should keep src/a.ts and src/b.ts (same directory)
    const files = result.rgSnippets.map(s => s.file);
    expect(files).toContain('src/a.ts');
    expect(files).toContain('src/b.ts');
    expect(files).not.toContain('tests/a.test.ts');
  });

  it('should respect minContextChars threshold', async () => {
    const smallContext: Context = {
      repoPath: '.',
      primaryText: 'p',
      rgSnippets: [
        { file: 'a.ts', line: 1, content: 'a'.repeat(1000) },
        { file: 'b.ts', line: 1, content: 'b'.repeat(1000) },
        { file: 'c.ts', line: 1, content: 'c'.repeat(1000) },
        { file: 'd.ts', line: 1, content: 'd'.repeat(1000) },
        { file: 'e.ts', line: 1, content: 'e'.repeat(1000) },
        { file: 'f.ts', line: 1, content: 'f'.repeat(1000) }
      ]
    };
    
    // LIMITS.minContextChars is 5000
    const failedFiles = ['a.ts'];
    const result = await ContextBuilder.shrinkContext(smallContext, failedFiles, ErrorType.COMPILATION);
    
    const totalLen = (result.primaryText?.length || 0) +
                     result.rgSnippets.reduce((s, n) => s + n.content.length, 0);
    
    expect(totalLen).toBeGreaterThanOrEqual(LIMITS.minContextChars);
  });
});
