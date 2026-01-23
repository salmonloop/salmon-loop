import { spawn } from 'child_process';

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { ContextBuilder } from '../../src/core/context.js';
import { normalizeDiff } from '../../src/core/diff.js';
import { rollbackFiles } from '../../src/core/git.js';

// Mock spawn for rollbackFiles tests
vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events');
  const mockSpawn = vi.fn().mockImplementation(() => {
    const emitter = new EventEmitter();
    (emitter as any).stdout = new EventEmitter();
    (emitter as any).stderr = new EventEmitter();
    // Default success behavior
    queueMicrotask(() => emitter.emit('close', 0));
    return emitter;
  });
  return {
    spawn: mockSpawn,
    // Add other exports if needed
  };
});

describe('Path Robustness', () => {
  describe('normalizeDiff Path Handling', () => {
    it('should throw for absolute Windows paths (security policy)', () => {
      const diff = `
diff --git a/C:\\Users\\test\\file.ts b/C:\\Users\\test\\file.ts
--- a/C:\\Users\\test\\file.ts
+++ b/C:\\Users\\test\\file.ts
@@ -1,1 +1,1 @@
-old
+new
      `.trim();
      expect(() => normalizeDiff(diff)).toThrow(/Path traversal detected/);
    });

    it('should handle mixed slashes and redundant separators', () => {
      const diff = `
diff --git a/folder//sub\\\\file.ts b/folder//sub\\\\file.ts
--- a/folder//sub\\\\file.ts
+++ b/folder//sub\\\\file.ts
@@ -1,1 +1,1 @@
-old
+new
      `.trim();
      const normalized = normalizeDiff(diff);
      expect(normalized).toContain('diff --git a/folder/sub/file.ts b/folder/sub/file.ts');
    });

    it('should handle special characters in filenames', () => {
      const specialChars = 'file with spaces & symbols #%@.ts';
      const diff = `
diff --git a/${specialChars} b/${specialChars}
--- a/${specialChars}
+++ b/${specialChars}
@@ -1,1 +1,1 @@
-old
+new
      `.trim();
      const normalized = normalizeDiff(diff);
      expect(normalized).toContain(`diff --git a/${specialChars} b/${specialChars}`);
    });

    it('should handle non-ASCII characters (UTF-8)', () => {
      const unicodePath = '目录/文件.ts';
      const diff = `
diff --git a/${unicodePath} b/${unicodePath}
--- a/${unicodePath}
+++ b/${unicodePath}
@@ -1,1 +1,1 @@
-old
+new
      `.trim();
      const normalized = normalizeDiff(diff);
      expect(normalized).toContain(`diff --git a/${unicodePath} b/${unicodePath}`);
    });

    it('should strip repository name prefix correctly', () => {
      // Case where LLM adds repo name: a/my-repo/src/index.ts
      const diff = `
diff --git a/my-repo/src/index.ts b/my-repo/src/index.ts
--- a/my-repo/src/index.ts
+++ b/my-repo/src/index.ts
      `.trim();
      const normalized = normalizeDiff(diff);
      expect(normalized).toContain('diff --git a/src/index.ts b/src/index.ts');
    });

    it('should handle various edge case paths without crashing', () => {
      const edgeCases = [
        '...',
        '....',
        ' . ',
        '.config',
        '-',
        '-rf',
        '--help',
        '~',
        'foo\nbar',
        'foo\rbar',
        'foo\tbar',
        'CON',
        'PRN',
        'AUX',
        'NUL',
        'folder.',
        'folder ',
        '😂',
        '🚀_project',
        'folder\u200bname',
        '@',
      ];

      edgeCases.forEach((path) => {
        const diff = `
diff --git a/${path} b/${path}
--- a/${path}
+++ b/${path}
@@ -1,1 +1,1 @@
-old
+new
        `.trim();
        const normalized = normalizeDiff(diff);
        expect(normalized).toContain('diff --git a/');
      });
    });
  });

  describe('rollbackFiles Path Safety', () => {
    const repoPath = '/fake/repo';

    beforeEach(() => {
      vi.useFakeTimers();
      // Reset the mock before each test if needed, though the factory handles basic behavior
      vi.mocked(spawn).mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should filter out absolute paths', async () => {
      const promise = rollbackFiles(repoPath, ['/etc/passwd', 'src/safe.ts']);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.attempted).toEqual(['src/safe.ts']);
    });

    it('should filter out path traversal attempts', async () => {
      const promise = rollbackFiles(repoPath, ['../../outside.ts', 'src/../safe.ts', 'safe.ts']);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.attempted).toEqual(['safe.ts']);
    });

    it('should handle Windows style absolute paths', async () => {
      const promise = rollbackFiles(repoPath, ['C:\\Windows\\system32\\cmd.exe', 'src\\file.ts']);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.attempted).not.toContain('C:/Windows/system32/cmd.exe');
      expect(result.attempted).toContain('src/file.ts');
    });

    it('should handle empty or whitespace paths', async () => {
      const promise = rollbackFiles(repoPath, ['', '   ', 'src/file.ts']);
      await vi.runAllTimersAsync();
      const result = await promise;
      expect(result.attempted).toEqual(['src/file.ts']);
    });
  });

  describe('ContextBuilder.extractFailedFiles Robustness', () => {
    it('should handle various path formats in error output', () => {
      const output = `
        Error: some error in "src/space path/file.ts":10:5
        Failed: /absolute/path/to/repo/src/file.ts:20
        Relative: ./src/rel.ts:30
        Windows: C:\\Users\\test\\src\\win.ts(40,10)
        No line: just/a/path.ts
        Unicode: Error in 中文路径/文件.ts:10:5
        Emoji: Error in 😂.ts:10:5
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('src/space path/file.ts');
      expect(files).toContain('absolute/path/to/repo/src/file.ts');
      expect(files).toContain('src/rel.ts');
      expect(files).toContain('Users/test/src/win.ts');
      expect(files).toContain('just/a/path.ts');
      expect(files).toContain('中文路径/文件.ts');
      expect(files).toContain('😂.ts');
    });

    it('should extract files with line numbers (from utils.test.ts)', () => {
      const output = `
        Error in src/core/loop.ts:10:5
        at Object.<anonymous> (tests/unit/loop.test.ts:20:10)
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('src/core/loop.ts');
      expect(files).toContain('tests/unit/loop.test.ts');
    });

    it('should extract files without line numbers if no traces found (from utils.test.ts)', () => {
      const output = `
        Failed to compile src/core/loop.ts
        Error in README.md
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('src/core/loop.ts');
      expect(files).toContain('README.md');
    });

    it('should ignore node_modules and .git (from utils.test.ts)', () => {
      const output = `
        Error in node_modules/package/index.js
        Error in .git/config
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toHaveLength(0);
    });

    it('should handle root files (from utils.test.ts)', () => {
      const output = 'Error in package.json';
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('package.json');
    });

    it('should handle very long paths', () => {
      const longPath = 'a/'.repeat(100) + 'file.ts';
      const output = `Error in ${longPath}:1:1`;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain(longPath);
    });

    it('should not be fooled by path-like strings in logs', () => {
      const output = `
        Version: 1.2.3
        IP: 127.0.0.1
        Date: 2023-01-01
        Not a file: something.else
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).not.toContain('127.0.0.1');
      expect(files).not.toContain('2023-01-01');
    });
  });
});
