import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'bun:test';

import { findBunPurityViolations } from '../../../scripts/check-bun-purity.ts';

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

describe('bun purity guard', () => {
  it('detects forbidden command in package scripts', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'bun-purity-'));
    tempDirs.push(repoRoot);

    await write(
      repoRoot,
      'package.json',
      JSON.stringify(
        {
          scripts: {
            verify: 'node -e "process.exit(0)"',
            lint: 'bun run lint',
          },
        },
        null,
        2,
      ),
    );

    const violations = await findBunPurityViolations(repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0].filePath).toBe('package.json');
    expect(violations[0].snippet).toContain('verify: node ');
  });

  it('detects forbidden command in hooks and workflows', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'bun-purity-'));
    tempDirs.push(repoRoot);

    await write(
      repoRoot,
      'package.json',
      JSON.stringify({ scripts: { verify: 'bun run verify' } }),
    );
    await write(repoRoot, '.githooks/pre-commit', 'npx eslint .\n');
    await write(repoRoot, '.github/workflows/ci.yml', 'run: npm run test\n');

    const violations = await findBunPurityViolations(repoRoot);
    expect(violations).toHaveLength(2);
    expect(violations.map((v) => v.filePath).sort()).toEqual([
      '.githooks/pre-commit',
      '.github/workflows/ci.yml',
    ]);
  });

  it('supports includePaths filtering', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'bun-purity-'));
    tempDirs.push(repoRoot);

    await write(
      repoRoot,
      'package.json',
      JSON.stringify(
        {
          scripts: {
            verify: 'node -e "process.exit(0)"',
          },
        },
        null,
        2,
      ),
    );
    await write(repoRoot, '.githooks/pre-commit', 'npx eslint .\n');

    const onlyHooks = await findBunPurityViolations(repoRoot, {
      includePaths: ['.githooks/pre-commit'],
    });
    expect(onlyHooks).toHaveLength(1);
    expect(onlyHooks[0].filePath).toBe('.githooks/pre-commit');
  });

  it('passes when only bun commands are used', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'bun-purity-'));
    tempDirs.push(repoRoot);

    await write(
      repoRoot,
      'package.json',
      JSON.stringify(
        {
          scripts: {
            verify: 'bun run lint && bun run test:full',
          },
        },
        null,
        2,
      ),
    );
    await write(repoRoot, '.githooks/pre-commit', 'bun run verify\n');

    const violations = await findBunPurityViolations(repoRoot);
    expect(violations).toEqual([]);
  });
});
