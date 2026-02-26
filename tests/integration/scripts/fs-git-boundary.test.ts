import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { findFsGitBoundaryViolations } from '../../../scripts/check-fs-git-boundary.ts';

const tempDirs: string[] = [];

async function write(repoRoot: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

async function createRepoWithAllowlist(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'fs-git-boundary-'));
  tempDirs.push(repoRoot);
  await write(
    repoRoot,
    'scripts/fs-git-boundary-allowlist.json',
    JSON.stringify(
      { fsDirectImports: [], gitDirectCommands: [], processDirectCommands: [] },
      null,
      2,
    ),
  );
  return repoRoot;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('fs/git boundary AST guard', () => {
  it('detects fs direct usage via require/import expressions', async () => {
    const repoRoot = await createRepoWithAllowlist();
    await write(
      repoRoot,
      'src/app.ts',
      "const fs = require('fs');\nawait import('node:fs/promises');\n",
    );

    const violations = await findFsGitBoundaryViolations(repoRoot);
    expect(violations).toContainEqual({ filePath: 'src/app.ts', reason: 'fs-direct-import' });
  });

  it('detects git direct command via spawn/execa/object command field', async () => {
    const repoRoot = await createRepoWithAllowlist();
    await write(
      repoRoot,
      'src/runner.ts',
      "import { execa } from 'execa';\nawait execa('git', ['status']);\nspawnSync('git', ['status']);\nconst opts = { command: 'git' };\n",
    );

    const violations = await findFsGitBoundaryViolations(repoRoot);
    expect(violations).toContainEqual({ filePath: 'src/runner.ts', reason: 'git-direct-command' });
  });

  it('does not flag comment/string false positives', async () => {
    const repoRoot = await createRepoWithAllowlist();
    await write(
      repoRoot,
      'src/safe.ts',
      "// from 'fs'\nconst text = \"spawnSync('git')\";\nconst fake = 'Bun.file';\n",
    );

    const violations = await findFsGitBoundaryViolations(repoRoot);
    expect(violations).toEqual([]);
  });

  it('detects process direct usage via child_process and Bun.spawn', async () => {
    const repoRoot = await createRepoWithAllowlist();
    await write(
      repoRoot,
      'src/process.ts',
      "import { spawn } from 'child_process';\nspawn('echo', ['x']);\nBun.spawn(['echo', 'x']);\n",
    );

    const violations = await findFsGitBoundaryViolations(repoRoot);
    expect(violations).toContainEqual({
      filePath: 'src/process.ts',
      reason: 'process-direct-command',
    });
  });
});
