import { describe, expect, it } from 'bun:test';

import {
  ensureInSandbox,
  isPathWithinDirectory,
  isSafeRelativePath,
  normalizePath,
  safeDirname,
  safeJoin,
  safeRelative,
  safeResolve,
} from '../../../src/core/utils/path.js';

describe('path utils', () => {
  describe('normalizePath', () => {
    it('converts Windows backslashes to forward slashes', () => {
      expect(normalizePath('src\\index.ts')).toBe('src/index.ts');
      expect(normalizePath('C:\\Users\\test\\file.txt')).toBe('C:/Users/test/file.txt');
    });

    it('preserves Unix paths unchanged', () => {
      expect(normalizePath('src/index.ts')).toBe('src/index.ts');
      expect(normalizePath('/home/user/file.txt')).toBe('/home/user/file.txt');
    });

    it('collapses duplicate slashes', () => {
      expect(normalizePath('src//index.ts')).toBe('src/index.ts');
      expect(normalizePath('src///index.ts')).toBe('src/index.ts');
    });

    it('handles mixed separators', () => {
      expect(normalizePath('src\\index\\test.ts')).toBe('src/index/test.ts');
      expect(normalizePath('src\\index/test.ts')).toBe('src/index/test.ts');
    });

    it('preserves UNC path prefixes', () => {
      expect(normalizePath('\\\\server\\share\\file.txt')).toBe('//server/share/file.txt');
    });

    it('handles empty string', () => {
      expect(normalizePath('')).toBe('');
    });

    it('handles root paths', () => {
      expect(normalizePath('/')).toBe('/');
      expect(normalizePath('C:\\')).toBe('C:/');
    });
  });

  describe('safeJoin', () => {
    it('joins path segments with forward slashes', () => {
      expect(safeJoin('src', 'index.ts')).toBe('src/index.ts');
    });

    it('normalizes Windows-style paths', () => {
      expect(safeJoin('src\\components', 'index.ts')).toBe('src/components/index.ts');
    });

    it('handles absolute paths', () => {
      const result = safeJoin('/home', 'user', 'file.txt');
      expect(result).toBe('/home/user/file.txt');
    });

    it('handles mixed separators in arguments', () => {
      expect(safeJoin('src\\components', 'index.ts')).toBe('src/components/index.ts');
    });
  });

  describe('safeResolve', () => {
    it('resolves paths to absolute paths with forward slashes', () => {
      const result = safeResolve('src', 'index.ts');
      expect(result).toMatch(/src\/index\.ts$/);
    });

    it('normalizes Windows paths', () => {
      const result = safeResolve('src\\index.ts');
      expect(result).toMatch(/[Ss]rc\/index\.ts$/);
    });
  });

  describe('safeRelative', () => {
    it('returns relative path with forward slashes', () => {
      const result = safeRelative('/home/user/src', '/home/user/src/index.ts');
      expect(result).toBe('index.ts');
    });

    it('handles nested directories', () => {
      const result = safeRelative('/home/user/src', '/home/user/src/components/button.ts');
      expect(result).toBe('components/button.ts');
    });
  });

  describe('safeDirname', () => {
    it('returns directory name with forward slashes', () => {
      expect(safeDirname('src/index.ts')).toBe('src');
      expect(safeDirname('src\\components\\button.ts')).toBe('src/components');
    });

    it('handles root paths', () => {
      // path.dirname returns '.' for root-level files, which is correct behavior
      expect(safeDirname('file.ts')).toBe('.');
      expect(safeDirname('src/file.ts')).toBe('src');
    });
  });

  describe('isSafeRelativePath', () => {
    it('returns true for safe relative paths', () => {
      expect(isSafeRelativePath('src/index.ts')).toBe(true);
      expect(isSafeRelativePath('components/button.ts')).toBe(true);
    });

    it('returns false for absolute Unix paths', () => {
      expect(isSafeRelativePath('/etc/passwd')).toBe(false);
      expect(isSafeRelativePath('/home/user/file.txt')).toBe(false);
    });

    it('returns false for absolute Windows paths', () => {
      expect(isSafeRelativePath('C:\\Windows\\system32')).toBe(false);
      expect(isSafeRelativePath('C:/Users/admin/file.txt')).toBe(false);
    });

    it('returns false for path traversal attempts', () => {
      expect(isSafeRelativePath('../secret.txt')).toBe(false);
      expect(isSafeRelativePath('../../etc/passwd')).toBe(false);
      expect(isSafeRelativePath('src/../../secret.txt')).toBe(false);
    });

    it('returns false for empty strings', () => {
      expect(isSafeRelativePath('')).toBe(false);
    });

    it('handles paths with mixed separators', () => {
      expect(isSafeRelativePath('src\\components/button.ts')).toBe(true);
    });
  });

  describe('isPathWithinDirectory', () => {
    it('returns true for nested paths', () => {
      expect(isPathWithinDirectory('/tmp', '/tmp/s8p-wt/repo')).toBe(true);
      expect(isPathWithinDirectory('/home/user', '/home/user/project/src')).toBe(true);
    });

    it('returns false for paths outside the directory', () => {
      expect(isPathWithinDirectory('/tmp', '/tmp-evil/worktree')).toBe(false);
      expect(isPathWithinDirectory('/home/user', '/home/other/project')).toBe(false);
    });

    it('returns true for exact root match when allowEqual=true', () => {
      expect(isPathWithinDirectory('/tmp', '/tmp', { allowEqual: true })).toBe(true);
      expect(isPathWithinDirectory('/home/user', '/home/user', { allowEqual: true })).toBe(true);
    });

    it('returns false for exact root match when allowEqual=false', () => {
      expect(isPathWithinDirectory('/tmp', '/tmp', { allowEqual: false })).toBe(false);
      expect(isPathWithinDirectory('/home/user', '/home/user', { allowEqual: false })).toBe(false);
    });

    it('handles Windows-style paths', () => {
      const root = 'C:\\Users\\test';
      const inside = 'C:\\Users\\test\\project\\src';
      const outside = 'C:\\Users\\other\\project';
      expect(isPathWithinDirectory(root, inside)).toBe(true);
      expect(isPathWithinDirectory(root, outside)).toBe(false);
    });
  });

  describe('ensureInSandbox', () => {
    it('returns normalized target when contained in root', () => {
      const result = ensureInSandbox('/tmp', '/tmp/a/b');
      expect(result.replace(/\\/g, '/').replace(/^[A-Z]:/, '')).toBe('/tmp/a/b');
    });

    it('throws for temp-prefix lookalike paths outside root', () => {
      expect(() => ensureInSandbox('/tmp', '/tmp-evil/a')).toThrow(/Security Violation/i);
    });

    it('throws for path traversal attempts', () => {
      expect(() => ensureInSandbox('/tmp/safe', '/tmp/other/../../etc/passwd')).toThrow(
        /Security Violation/i,
      );
    });

    it('throws for absolute paths outside sandbox', () => {
      expect(() => ensureInSandbox('/sandbox', '/etc/passwd')).toThrow(/Security Violation/i);
    });

    it('handles Windows-style paths', () => {
      const root = 'C:\\sandbox';
      const target = 'C:\\sandbox\\project\\file.txt';
      expect(() => ensureInSandbox(root, target)).not.toThrow();
    });
  });

  describe('Cross-platform path patterns', () => {
    it('handles blob path pattern matching', () => {
      const posixPath = 'blobs/tool-outputSummary.log';
      const windowsPath = 'blobs\\tool-outputSummary.log';
      const mixedPath = 'blobs\\subdir/file.log';

      const blobPattern = /^blobs[\\/]/;
      expect(blobPattern.test(posixPath)).toBe(true);
      expect(blobPattern.test(windowsPath)).toBe(true);
      expect(blobPattern.test(mixedPath)).toBe(true);
    });

    it('normalizes paths before pattern matching', () => {
      const windowsPath = 'blobs\\tool-outputSummary-2026-03-06T11-31-00-886Z-ee495583.log';
      const normalized = normalizePath(windowsPath);

      const posixPattern = /^blobs\//;
      const crossPlatformPattern = /^blobs[\\/]/;

      expect(posixPattern.test(normalized)).toBe(true);
      expect(crossPlatformPattern.test(windowsPath)).toBe(true);
    });

    it('handles various path formats in error messages', () => {
      const testCases = [
        { input: 'Error in file.ts:10:5', expected: 'file.ts' },
        { input: 'Error in src/index.ts:20:10', expected: 'src/index.ts' },
        { input: 'Error in C:\\Users\\test\\file.ts:30:15', expected: 'C:/Users/test/file.ts' },
        {
          input: 'Error in src\\components\\Button.tsx:40:5',
          expected: 'src/components/Button.tsx',
        },
      ];

      testCases.forEach(({ input, expected }) => {
        const normalized = normalizePath(input);
        expect(normalized).toContain(expected.replace('\\', '/'));
      });
    });
  });

  describe('Edge cases', () => {
    it('handles empty path segments', () => {
      expect(safeJoin('src', '', 'index.ts')).toBe('src/index.ts');
    });

    it('handles paths with spaces', () => {
      expect(normalizePath('my project\\src\\index.ts')).toBe('my project/src/index.ts');
    });

    it('handles Unicode characters in paths', () => {
      expect(normalizePath('项目\\文件.ts')).toBe('项目/文件.ts');
      expect(normalizePath('プロジェクト\\ファイル.ts')).toBe('プロジェクト/ファイル.ts');
    });

    it('handles emoji in paths', () => {
      expect(normalizePath('😀\\test.ts')).toBe('😀/test.ts');
    });

    it('handles very long paths', () => {
      const longPath = 'a/'.repeat(100) + 'file.ts';
      const normalized = normalizePath(longPath);
      expect(normalized).toContain('file.ts');
      expect(normalized).not.toContain('\\\\');
    });
  });
});
