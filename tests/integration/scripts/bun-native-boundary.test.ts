import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { findBunNativeBoundaryViolations } from '../../../scripts/check-bun-native-boundary.ts';

const tempDirs: string[] = [];

async function write(repoRoot: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

async function createRepoWithAllowlist(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'bun-native-boundary-'));
  tempDirs.push(repoRoot);
  await write(
    repoRoot,
    'scripts/bun-native-boundary-allowlist.json',
    JSON.stringify({ bunDirectUsage: [] }, null, 2),
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

describe('bun native boundary AST guard', () => {
  it('detects Bun direct usage via property/element access', async () => {
    const repoRoot = await createRepoWithAllowlist();
    await write(repoRoot, 'src/a.ts', "const a = Bun.file('a.txt');\nconst b = Bun['env'];\n");

    const violations = await findBunNativeBoundaryViolations(repoRoot);
    expect(violations).toContainEqual({ filePath: 'src/a.ts', reason: 'bun-direct-usage' });
  });

  it('does not flag comment/string false positives', async () => {
    const repoRoot = await createRepoWithAllowlist();
    await write(repoRoot, 'src/safe.ts', "// Bun.file('x')\nconst s = 'Bun.write';\n");

    const violations = await findBunNativeBoundaryViolations(repoRoot);
    expect(violations).toEqual([]);
  });
});
