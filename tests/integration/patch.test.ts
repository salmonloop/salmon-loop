import { validateDiff, normalizeDiff } from '../../src/core/diff.js';
import { LIMITS } from '../../src/core/limits.js';

describe('Patch Integration Tests', () => {
  it('should validate a correct diff', () => {
    const diff = 
      'diff --git a/file1.ts b/file1.ts\n' +
      '--- a/file1.ts\n' +
      '+++ b/file1.ts\n' +
      '@@ -1,1 +1,1 @@\n' +
      '-old\n' +
      '+new';
    
    const meta = validateDiff(diff);
    expect(meta.fileCount).toBe(1);
    expect(meta.changedFiles).toContain('file1.ts');
  });

  it('should throw error if diff exceeds file limit', () => {
    let largeDiff = '';
    for (let i = 0; i < LIMITS.maxFilesChanged + 1; i++) {
      largeDiff += `diff --git a/file${i}.ts b/file${i}.ts\n--- a/file${i}.ts\n+++ b/file${i}.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n`;
    }

    expect(() => validateDiff(largeDiff)).toThrow(/Patch affects/);
  });

  it('should normalize diff by removing markdown markers', () => {
    const diffWithMarkdown = '```diff\n' +
      'diff --git a/file1.ts b/file1.ts\n' +
      '--- a/file1.ts\n' +
      '+++ b/file1.ts\n' +
      '@@ -1,1 +1,1 @@\n' +
      '-old\n' +
      '+new\n' +
      '```';
    
    const normalized = normalizeDiff(diffWithMarkdown);
    expect(normalized).not.toContain('```diff');
    expect(normalized).not.toContain('```');
    expect(normalized).toContain('diff --git');
  });
});
