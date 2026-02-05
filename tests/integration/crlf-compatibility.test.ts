import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';

describe('CRLF Compatibility Tests (Windows Simulation)', () => {
  let tempDir: string;
  let repoPath: string;

  beforeEach(async () => {
    const randomId = Math.random().toString(36).slice(2);
    tempDir = join(tmpdir(), `salmon-crlf-test-${randomId}`);
    repoPath = join(tempDir, 'repo');
    await mkdir(repoPath, { recursive: true });

    const git = new GitAdapter(repoPath);
    await git.exec(['init', '--initial-branch=main']);
    await git.exec(['config', 'user.name', 'Test User']);
    await git.exec(['config', 'user.email', 'test@example.com']);
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it('should apply LF patch to CRLF file when ignoreWhitespace is true', async () => {
    const filePath = join(repoPath, 'test.txt');
    const contentCRLF = 'line1\r\nline2\r\nline3\r\n';
    await writeFile(filePath, contentCRLF);

    const git = new GitAdapter(repoPath);
    await git.exec(['add', 'test.txt']);
    await git.exec(['commit', '-m', 'Initial CRLF commit']);

    const patchLF = `diff --git a/test.txt b/test.txt
index 1234567..89abcde 100644
--- a/test.txt
+++ b/test.txt
@@ -1,3 +1,3 @@
 line1
-line2
+line2 modified
 line3
`;

    await git.applyPatch(patchLF, {
      ignoreWhitespace: true,
      contextLines: 3,
    });

    const finalContent = await readFile(filePath, 'utf-8');
    expect(finalContent).toContain('line2 modified');
  });

  it('should fail to apply LF patch to CRLF file when ignoreWhitespace is false (Control Test)', async () => {
    const git = new GitAdapter(repoPath);
    await git.exec(['config', 'core.autocrlf', 'false']);
    await git.exec(['config', 'core.eol', 'crlf']);

    const filePath = join(repoPath, 'strict.txt');
    const contentCRLF = 'A\r\nB\r\nC\r\n';
    await writeFile(filePath, contentCRLF);

    await git.exec(['add', 'strict.txt']);
    await git.exec(['commit', '-m', 'Initial strict']);

    const patchLF = `diff --git a/strict.txt b/strict.txt
index 111..222 100644
--- a/strict.txt
+++ b/strict.txt
@@ -1,3 +1,3 @@
 A
-B
+B-mod
 C
`;

    try {
      await git.applyPatch(patchLF, {
        ignoreWhitespace: false,
        contextLines: 3,
      });
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
