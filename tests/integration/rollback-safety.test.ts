import { GitAdapter } from '../../src/core/adapters/git/git-adapter.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('Rollback Safety Tests - CRITICAL USER DATA PROTECTION', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('CRITICAL: Should NEVER destroy staged changes by default (no ref)', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'important.ts', content: 'committed content' }],
    });

    await helper.modifyFile(repo.path, 'important.ts', 'staged user changes', true);
    await helper.modifyFile(repo.path, 'important.ts', 'agent garbage content');

    const git = new GitAdapter(repo.path);
    await git.rollbackFiles(['important.ts']);

    const content = await helper.readFile(repo.path, 'important.ts');
    expect(content).toBe('staged user changes');
  });

  it('CRITICAL: Should preserve staged changes in other files when rolling back a target file', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'target.ts', content: 'v1' },
        { path: 'other.ts', content: 'v1' },
      ],
    });

    await helper.modifyFile(repo.path, 'other.ts', 'user staged v2', true);
    await helper.modifyFile(repo.path, 'target.ts', 'agent messy v2');

    const git = new GitAdapter(repo.path);
    await git.rollbackFiles(['target.ts']);

    const targetContent = await helper.readFile(repo.path, 'target.ts');
    expect(targetContent).toBe('v1');

    const otherContent = await helper.readFile(repo.path, 'other.ts');
    expect(otherContent).toBe('user staged v2');
  });

  it('CRITICAL: Should not delete untracked files', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'file.ts', content: 'v1' }],
    });

    await helper.writeFile(repo.path, '.env.local', 'SECRET=123');
    await helper.modifyFile(repo.path, 'file.ts', 'agent mess');

    const git = new GitAdapter(repo.path);
    await git.rollbackFiles(['file.ts']);

    const exists = await helper.fileExists(repo.path, '.env.local');
    expect(exists).toBe(true);
  });
});
