import { spawn } from 'child_process';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import { ContextBuilder } from '../../src/core/context/builder.js';

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
  };
});

describe('Path Robustness', () => {
  // ... (keeping normalizeDiff tests)

  describe('rollbackFiles Path Safety', () => {
    const repoPath = '/fake/repo';
    const adapter = new GitAdapter(repoPath);

    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(spawn).mockClear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should filter out absolute paths', async () => {
      const promise = adapter.rollbackFiles(['/etc/passwd', 'src/safe.ts']);
      await vi.runAllTimersAsync();
      await promise;
      // In the new adapter, it internally sanitizes.
      // We can't easily check 'attempted' unless we spy on exec.
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['src/safe.ts']),
        expect.anything(),
      );
      const callArgs = vi.mocked(spawn).mock.calls[0][1];
      expect(callArgs).not.toContain('/etc/passwd');
    });

    it('should filter out path traversal attempts', async () => {
      const promise = adapter.rollbackFiles(['../../outside.ts', 'src/../safe.ts', 'safe.ts']);
      await vi.runAllTimersAsync();
      await promise;
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['safe.ts']),
        expect.anything(),
      );
      const callArgs = vi.mocked(spawn).mock.calls[0][1];
      expect(callArgs).not.toContain('../../outside.ts');
    });

    it('should handle Windows style absolute paths', async () => {
      const promise = adapter.rollbackFiles(['C:\\Windows\\system32\\cmd.exe', 'src\\file.ts']);
      await vi.runAllTimersAsync();
      await promise;
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['src/file.ts']),
        expect.anything(),
      );
    });

    it('should handle empty or whitespace paths', async () => {
      const promise = adapter.rollbackFiles(['', '   ', 'src/file.ts']);
      await vi.runAllTimersAsync();
      await promise;
      expect(vi.mocked(spawn)).toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['src/file.ts']),
        expect.anything(),
      );
    });
  });

  describe('ContextBuilder.extractFailedFiles Robustness', () => {
    it('should handle various path formats in error output', () => {
      const unicodeFile = `unicode-path/\u00E9-file.ts`;
      const emojiFile = `\u{1F602}.ts`;
      const output = `
        Error: some error in "src/space path/file.ts":10:5
        Failed: /absolute/path/to/repo/src/file.ts:20
        Relative: ./src/rel.ts:30
        Windows: C:\\Users\\test\\src\\win.ts(40,10)
        No line: just/a/path.ts
        Unicode: Error in ${unicodeFile}:10:5
        Emoji: Error in ${emojiFile}:10:5
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('src/space path/file.ts');
      expect(files).toContain('absolute/path/to/repo/src/file.ts');
      expect(files).toContain('src/rel.ts');
      expect(files).toContain('Users/test/src/win.ts');
      expect(files).toContain('just/a/path.ts');
      expect(files).toContain(unicodeFile);
      expect(files).toContain(emojiFile);
    });

    it('should extract files with line numbers (from utils.test.ts)', () => {
      const output = `
        Error in src/core/runtime/loop.ts:10:5
        at Object.<anonymous> (tests/unit/loop.test.ts:20:10)
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('src/core/runtime/loop.ts');
      expect(files).toContain('tests/unit/loop.test.ts');
    });

    it('should extract files without line numbers if no traces found (from utils.test.ts)', () => {
      const output = `
        Failed to compile src/core/runtime/loop.ts
        Error in README.md
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('src/core/runtime/loop.ts');
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
