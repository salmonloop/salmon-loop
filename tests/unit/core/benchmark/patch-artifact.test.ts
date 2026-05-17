import { afterEach, describe, expect, it } from 'bun:test';

import { buildBenchmarkPatchArtifact } from '../../../../src/core/benchmark/patch-artifact.js';
import { RealFsTestHelper } from '../../../helpers/real-fs-helper.js';

describe('benchmark patch artifact', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('exports tracked and untracked workspace changes as an applyable git patch without touching index', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: '.gitignore', content: '.salmonloop/\n' },
      ],
    });
    await helper.writeFile(repo.path, 'src/a.ts', 'export const a = 2;\n');
    await helper.writeFile(repo.path, 'src/b.ts', 'export const b = 3;\n');
    await helper.writeFile(repo.path, '.salmonloop/generated.log', 'ignored\n');

    const beforeStatus = await helper.git(repo.path, ['status', '--short'], { trim: false });
    const artifact = await buildBenchmarkPatchArtifact({ repoPath: repo.path });
    const afterStatus = await helper.git(repo.path, ['status', '--short'], { trim: false });

    expect(afterStatus.stdout).toBe(beforeStatus.stdout);
    expect(artifact.isEmpty).toBe(false);
    expect(artifact.bytes).toBe(Buffer.byteLength(artifact.patch, 'utf8'));
    expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.changedFiles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(artifact.patch).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(artifact.patch).toContain('-export const a = 1;');
    expect(artifact.patch).toContain('+export const a = 2;');
    expect(artifact.patch).toContain('diff --git a/src/b.ts b/src/b.ts');
    expect(artifact.patch).toContain('new file mode 100644');
    expect(artifact.patch).not.toContain('.salmonloop/generated.log');

    const clean = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: '.gitignore', content: '.salmonloop/\n' },
      ],
    });
    await helper.writeFile(clean.path, 'patch.diff', artifact.patch);
    const check = await helper.git(clean.path, ['apply', '--check', 'patch.diff']);
    expect(check.exitCode).toBe(0);
  });

  it('includes staged tracked changes in the final workspace patch', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'src/a.ts', content: 'export const a = 1;\n' }],
    });
    await helper.writeFile(repo.path, 'src/a.ts', 'export const a = 2;\n');
    const add = await helper.git(repo.path, ['add', 'src/a.ts']);
    expect(add.exitCode).toBe(0);

    const artifact = await buildBenchmarkPatchArtifact({ repoPath: repo.path });

    expect(artifact.changedFiles).toEqual(['src/a.ts']);
    expect(artifact.patch).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(artifact.patch).toContain('-export const a = 1;');
    expect(artifact.patch).toContain('+export const a = 2;');
  });

  it('omits excluded artifact paths while preserving applyability', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: 'artifacts/existing.patch', content: 'old\n' },
      ],
    });
    await helper.writeFile(repo.path, 'src/a.ts', 'export const a = 2;\n');
    await helper.writeFile(repo.path, 'artifacts/existing.patch', 'new\n');
    await helper.writeFile(repo.path, 'artifacts/new.jsonl', '{}\n');

    const artifact = await buildBenchmarkPatchArtifact({
      repoPath: repo.path,
      excludePaths: [`${repo.path}/artifacts/existing.patch`, `${repo.path}/artifacts/new.jsonl`],
    });

    expect(artifact.changedFiles).toEqual(['src/a.ts']);
    expect(artifact.patch).toContain('diff --git a/src/a.ts b/src/a.ts');
    expect(artifact.patch).not.toContain('artifacts/existing.patch');
    expect(artifact.patch).not.toContain('artifacts/new.jsonl');

    const clean = await helper.createGitRepo({
      initialFiles: [
        { path: 'src/a.ts', content: 'export const a = 1;\n' },
        { path: 'artifacts/existing.patch', content: 'old\n' },
      ],
    });
    await helper.writeFile(clean.path, 'patch.diff', artifact.patch);
    const check = await helper.git(clean.path, ['apply', '--check', 'patch.diff']);
    expect(check.exitCode).toBe(0);
  });

  it('handles untracked paths with spaces', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'README.md', content: '# Test\n' }],
    });
    await helper.writeFile(repo.path, 'src/file name.ts', 'export const value = 1;\n');

    const artifact = await buildBenchmarkPatchArtifact({ repoPath: repo.path });

    expect(artifact.changedFiles).toEqual(['src/file name.ts']);
    expect(artifact.patch).toContain('diff --git a/src/file name.ts b/src/file name.ts');

    const clean = await helper.createGitRepo({
      initialFiles: [{ path: 'README.md', content: '# Test\n' }],
    });
    await helper.writeFile(clean.path, 'patch.diff', artifact.patch);
    const check = await helper.git(clean.path, ['apply', '--check', 'patch.diff']);
    expect(check.exitCode).toBe(0);
  });
});
