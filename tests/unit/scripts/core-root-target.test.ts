import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { auditCoreRoot } from '../../../scripts/audit-core-root.ts';
import { findMigratedCoreRootFiles } from '../../helpers/core-root-migration-targets.js';

const tempDirs: string[] = [];

async function write(repoRoot: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

async function createFixtureRepo(rootCoreFiles: string[]): Promise<string> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'core-root-target-'));
  tempDirs.push(repoRoot);

  await write(repoRoot, 'src/index.ts', 'export {}\n');
  await write(repoRoot, 'src/core/keep.ts', 'export const keep = true;\n');
  for (const file of rootCoreFiles) {
    await write(repoRoot, file, 'export const migrated = true;\n');
  }

  return repoRoot;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('core root migration target', () => {
  it('passes when fixture has no migrated implementation files in src/core root', async () => {
    const repoRoot = await createFixtureRepo([]);

    const report = await auditCoreRoot({ repoRoot });
    const migratedInRoot = findMigratedCoreRootFiles(report.rootFiles.map((f) => f.path));

    expect(migratedInRoot).toEqual([]);
  });

  it('detects migrated implementation files when they reappear in src/core root', async () => {
    const repoRoot = await createFixtureRepo(['src/core/runtime.ts']);

    const report = await auditCoreRoot({ repoRoot });
    const migratedInRoot = findMigratedCoreRootFiles(report.rootFiles.map((f) => f.path));

    expect(migratedInRoot).toEqual(['src/core/runtime.ts']);
  });
});
