import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { ContextBuilder } from '../../src/core/context.js';

describe('ContextBuilder', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'salmon-context-test-'));
    execSync('git init', { cwd: tempDir });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should build context with primary file', async () => {
    const filePath = join(tempDir, 'test.ts');
    await writeFile(filePath, 'console.log("hello");');

    const context = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
      file: 'test.ts',
    });

    expect(context.primaryText).toContain('console.log("hello");');
    expect(context.repoPath).toBe(tempDir);
  });

  it('should build context with git diff', async () => {
    const filePath = join(tempDir, 'test.ts');
    await writeFile(filePath, 'initial');
    execSync('git add . && git commit -m "initial"', { cwd: tempDir });
    await writeFile(filePath, 'modified');

    const context = await ContextBuilder.build({
      instruction: 'fix something',
      verify: 'npm test',
      repoPath: tempDir,
    });

    expect(context.gitDiff).toContain('+modified');
  });
});
