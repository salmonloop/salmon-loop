import { describe, it, expect, afterEach } from 'vitest';

import { rollbackFiles } from '../../src/core/git.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Rollback Safety Tests - CRITICAL USER DATA PROTECTION', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('CRITICAL: Should NEVER destroy staged changes by default (no ref)', async () => {
    // 1. Setup: Create a file with committed content
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'important.ts', content: 'committed content' }],
    });

    // 2. User Action: Modify and STAGE the file (simulate user explicitly saving work)
    await helper.modifyFile(repo.path, 'important.ts', 'staged user changes', true);

    // 3. Agent Action: Modify the file again (Working Tree is now dirty on top of Staged)
    // This simulates the Agent trying to apply a patch and failing/leaving garbage
    await helper.modifyFile(repo.path, 'important.ts', 'agent garbage content');

    // Verify current state:
    // HEAD: 'committed content'
    // Index: 'staged user changes'
    // Worktree: 'agent garbage content'
    let status = await helper.getGitStatus(repo.path);
    expect(status).toContain('MM important.ts'); // Modified in Index AND Worktree

    // 4. Recovery: Agent calls rollbackFiles WITHOUT a ref (default behavior)
    // This implies "undo my mess in the working tree"
    const result = await rollbackFiles(repo.path, ['important.ts']);
    expect(result.ok).toBe(true);

    // 5. CRITICAL ASSERTION:
    // The file should be restored to the STAGED content, NOT the committed content.
    // If it reverts to 'committed content', we have DESTROYED user's staged work!
    const content = await helper.readFile(repo.path, 'important.ts');
    expect(content).toBe('staged user changes');

    // Verify status is back to just "Modified in Index" (M_ status)
    status = await helper.getGitStatus(repo.path);
    expect(status).toContain('M  important.ts');
  });

  it('CRITICAL: Should preserve staged changes in other files when rolling back a target file', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'target.ts', content: 'v1' },
        { path: 'other.ts', content: 'v1' },
      ],
    });

    // User stages changes in other.ts
    await helper.modifyFile(repo.path, 'other.ts', 'user staged v2', true);

    // Agent modifies target.ts
    await helper.modifyFile(repo.path, 'target.ts', 'agent messy v2');

    // Agent rolls back target.ts
    await rollbackFiles(repo.path, ['target.ts']);

    // Assert target.ts is reverted
    const targetContent = await helper.readFile(repo.path, 'target.ts');
    expect(targetContent).toBe('v1');

    // CRITICAL ASSERTION: other.ts MUST remain staged
    const otherContent = await helper.readFile(repo.path, 'other.ts');
    expect(otherContent).toBe('user staged v2');

    const status = await helper.getGitStatus(repo.path);
    expect(status).toContain('M  other.ts');
  });

  it('CRITICAL: Should not delete untracked files', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'file.ts', content: 'v1' }],
    });

    // User creates a secret file (untracked)
    await helper.writeFile(repo.path, '.env.local', 'SECRET=123');

    // Agent modifies file.ts
    await helper.modifyFile(repo.path, 'file.ts', 'agent mess');

    // Agent rolls back
    await rollbackFiles(repo.path, ['file.ts']);

    // Untracked file must still exist
    const exists = await helper.fileExists(repo.path, '.env.local');
    expect(exists).toBe(true);
  });
});
