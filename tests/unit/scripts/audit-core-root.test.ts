import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { auditCoreRoot } from '../../../scripts/audit-core-root.ts';

const tempDirs: string[] = [];

async function write(repoRoot: string, relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(repoRoot, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('auditCoreRoot', () => {
  it('reports orphan and test-only root files', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'core-audit-'));
    tempDirs.push(repoRoot);

    await write(repoRoot, 'src/core/used-by-cli.ts', 'export const a = 1;\n');
    await write(repoRoot, 'src/core/test-only.ts', 'export const b = 2;\n');
    await write(repoRoot, 'src/core/orphan.ts', 'export const c = 3;\n');
    await write(
      repoRoot,
      'src/cli/entry.ts',
      "import { a } from '../core/used-by-cli.js';\nexport const x = a;\n",
    );
    await write(
      repoRoot,
      'tests/unit/sample.test.ts',
      "import { b } from '../../src/core/test-only.js';\nvoid b;\n",
    );

    const report = await auditCoreRoot({ repoRoot });

    expect(report.summary.rootFileCount).toBe(3);
    expect(report.summary.orphanRootFiles).toEqual(['src/core/orphan.ts']);
    expect(report.summary.testOnlyRootFiles).toEqual(['src/core/test-only.ts']);

    const usedByCli = report.rootFiles.find((f) => f.path === 'src/core/used-by-cli.ts');
    expect(usedByCli?.inboundRefs).toBe(1);
    expect(usedByCli?.refsByArea.cli).toBe(1);
  });
});
