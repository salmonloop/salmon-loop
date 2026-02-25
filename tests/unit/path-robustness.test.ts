import { ContextBuilder } from '../../src/core/context/builder.js';

describe('Path Robustness', () => {
  // ... (keeping normalizeDiff tests)

  describe('rollbackFiles Path Safety', () => {
    const repoPath = '/fake/repo';
    let adapter: any;
    let runGitCommandMock: any;

    beforeEach(async () => {
      const gitRunner = await import('../../src/core/adapters/git/git-runner.js');
      runGitCommandMock = spyOn(gitRunner, 'runGitCommand').mockResolvedValue({
        ok: true,
        code: 0,
        signal: null,
        stdout: Buffer.from(''),
        stderr: '',
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
      });
      const { GitAdapter } = await import('../../src/core/adapters/git/git-adapter.js');
      adapter = new GitAdapter(repoPath);
    });
    afterEach(() => {
      mock.restore();
    });

    function getLastCallArgs(): string[] {
      const lastCall = runGitCommandMock.mock.calls.at(-1);
      if (!lastCall) return [];
      return lastCall[0].args;
    }

    it('should filter out absolute paths', async () => {
      await adapter.rollbackFiles(['/etc/passwd', 'src/safe.ts']);
      const callArgs = getLastCallArgs();
      expect(callArgs).toContain('src/safe.ts');
      expect(callArgs).not.toContain('/etc/passwd');
    });

    it('should filter out path traversal attempts', async () => {
      await adapter.rollbackFiles(['../../outside.ts', 'src/../safe.ts', 'safe.ts']);
      const callArgs = getLastCallArgs();
      expect(callArgs).toContain('safe.ts');
      expect(callArgs).not.toContain('../../outside.ts');
    });

    it('should handle Windows style absolute paths', async () => {
      await adapter.rollbackFiles(['C:\\Windows\\system32\\cmd.exe', 'src\\file.ts']);
      const callArgs = getLastCallArgs();
      expect(callArgs).toContain('src/file.ts');
    });

    it('should handle empty or whitespace paths', async () => {
      await adapter.rollbackFiles(['', '   ', 'src/file.ts']);
      const callArgs = getLastCallArgs();
      expect(callArgs).toContain('src/file.ts');
    });
  });

  describe('ContextBuilder.extractFailedFiles Robustness', () => {
    it('should handle various path formats in error output', () => {
      const unicodeFile = `unicode-path/\u00E9-file.md`;
      const emojiFile = `\u{1F602}.json`;
      const output = `
        Error: some error in "docs/space path/file.md":10:5
        Failed: /absolute/path/to/repo/docs/file.md:20
        Relative: ./docs/rel.md:30
        Windows: C:\\Users\\test\\docs\\win.md(40,10)
        No line: just/a/path.md
        Unicode: Error in ${unicodeFile}:10:5
        Emoji: Error in ${emojiFile}:10:5
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('docs/space path/file.md');
      expect(files).toContain('absolute/path/to/repo/docs/file.md');
      expect(files).toContain('docs/rel.md');
      expect(files).toContain('Users/test/docs/win.md');
      expect(files).toContain('just/a/path.md');
      expect(files).toContain(unicodeFile);
      expect(files).toContain(emojiFile);
    });

    it('should extract files with line numbers (from utils.test.ts)', () => {
      const output = `
        Error in logs/runtime.log:10:5
        at Object.<anonymous> (docs/testing.md:20:10)
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('logs/runtime.log');
      expect(files).toContain('docs/testing.md');
    });

    it('should extract files without line numbers if no traces found (from utils.test.ts)', () => {
      const output = `
        Failed to compile docs/guide.md
        Error in README.md
      `;
      const files = ContextBuilder.extractFailedFiles(output);
      expect(files).toContain('docs/guide.md');
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
      const longPath = 'a/'.repeat(100) + 'file.md';
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
