import { describe, it, expect } from 'vitest';
import { extractFailedFiles, shrinkContext } from '../../src/core/loop';
import { Context } from '../../src/core/types';

describe('extractFailedFiles', () => {
  it('should extract files with line numbers', () => {
    const output = `
      Error in src/core/loop.ts:10:5
      at Object.<anonymous> (tests/unit/loop.test.ts:20:10)
    `;
    const files = extractFailedFiles(output);
    expect(files).toContain('src/core/loop.ts');
    expect(files).toContain('tests/unit/loop.test.ts');
  });

  it('should extract files without line numbers if no traces found', () => {
    const output = `
      Failed to compile src/core/loop.ts
      Error in README.md
    `;
    const files = extractFailedFiles(output);
    expect(files).toContain('src/core/loop.ts');
    expect(files).toContain('README.md');
  });

  it('should ignore node_modules and .git', () => {
    const output = `
      Error in node_modules/package/index.js
      Error in .git/config
    `;
    const files = extractFailedFiles(output);
    expect(files).toHaveLength(0);
  });

  it('should handle root files', () => {
    const output = 'Error in package.json';
    const files = extractFailedFiles(output);
    expect(files).toContain('package.json');
  });
});

describe('shrinkContext', () => {
  it('should filter rgSnippets based on failed files', () => {
    const context: Context = {
      repoPath: '.',
      rgSnippets: [
        { file: 'src/a.ts', line: 1, content: 'a' },
        { file: 'src/b.ts', line: 1, content: 'b' },
      ],
    } as any;

    const failedFiles = ['src/a.ts'];
    const newContext = shrinkContext(context, failedFiles);

    expect(newContext.rgSnippets).toHaveLength(1);
    expect(newContext.rgSnippets[0].file).toBe('src/a.ts');
  });
});
