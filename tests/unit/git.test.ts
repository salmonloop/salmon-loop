import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { getGitDiff, getGitStatus, applyPatch, rollbackFiles } from '../../src/core/git.js';

describe('Git Utils', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'salmon-git-test-'));
    execSync('git init', { cwd: tempDir });
    execSync('git config user.email "test@example.com"', { cwd: tempDir });
    execSync('git config user.name "Test User"', { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should get git diff for unstaged changes', async () => {
    const filePath = join(tempDir, 'test.txt');
    await writeFile(filePath, 'initial');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });
    await writeFile(filePath, 'modified');

    const diff = await getGitDiff(tempDir);
    expect(diff).toContain('+modified');
    expect(diff).toContain('-initial');
  });

  it('should get git diff for staged changes', async () => {
    const filePath = join(tempDir, 'test.txt');
    await writeFile(filePath, 'initial');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });
    await writeFile(filePath, 'staged');
    execSync('git add .', { cwd: tempDir });

    const diff = await getGitDiff(tempDir, true);
    expect(diff).toContain('+staged');
  });

  it('should get git status', async () => {
    const filePath = join(tempDir, 'new.txt');
    await writeFile(filePath, 'new file');
    
    const status = await getGitStatus(tempDir);
    expect(status).toContain('?? new.txt');
  });

  it('should apply a patch', async () => {
    const filePath = join(tempDir, 'test.txt');
    await writeFile(filePath, 'line1\n');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });

    const patch = `diff --git a/test.txt b/test.txt
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-line1
+line2
`;
    await applyPatch(tempDir, patch);
    const content = await import('fs/promises').then(fs => fs.readFile(filePath, 'utf-8'));
    expect(content).toBe('line2\n');
  });

  it('should rollback specific files', async () => {
    const filePath = join(tempDir, 'test.txt');
    await writeFile(filePath, 'initial');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });
    await writeFile(filePath, 'modified');

    await rollbackFiles(tempDir, ['test.txt']);
    const content = await import('fs/promises').then(fs => fs.readFile(filePath, 'utf-8'));
    expect(content).toBe('initial');
  });
});
