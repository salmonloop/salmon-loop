import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { findRuntimeCommandHardcoding } from '../../../scripts/check-target-runtime-hardcoding.ts';

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

describe('target runtime boundary guard', () => {
  it('allows package-manager commands only under src/core/target-runtime', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'runtime-boundary-'));
    tempDirs.push(repoRoot);

    await write(
      repoRoot,
      'src/core/target-runtime/command-resolver.ts',
      "export const cmd = 'npm run test';\n",
    );
    await write(
      repoRoot,
      'src/cli/commands/run/preflight.ts',
      "export const cmd = 'pnpm run test';\n",
    );

    const violations = await findRuntimeCommandHardcoding(repoRoot);
    expect(violations).toHaveLength(1);
    expect(violations[0].filePath).toBe(path.join('src', 'cli', 'commands', 'run', 'preflight.ts'));
    expect(violations[0].snippet).toBe('pnpm run');
  });

  it('returns empty result when no disallowed hardcoding exists', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'runtime-boundary-'));
    tempDirs.push(repoRoot);

    await write(
      repoRoot,
      'src/core/target-runtime/command-resolver.ts',
      "export const cmd = 'bun run test';\n",
    );
    await write(
      repoRoot,
      'src/cli/commands/run/preflight.ts',
      "export const cmd = 'project-test';\n",
    );

    const violations = await findRuntimeCommandHardcoding(repoRoot);
    expect(violations).toEqual([]);
  });
});
