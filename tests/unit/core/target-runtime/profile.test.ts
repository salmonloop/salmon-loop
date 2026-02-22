import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { detectNodeRuntimeProfile } from '../../../../src/core/target-runtime/profile.js';

describe('detectNodeRuntimeProfile', () => {
  let repoPath = '';

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'salmon-loop-target-runtime-'));
  });

  afterEach(async () => {
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true });
    }
  });

  test('returns undefined when package.json is missing', async () => {
    expect(await detectNodeRuntimeProfile(repoPath)).toBeUndefined();
  });

  test('prefers packageManager field over lockfiles', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify(
        {
          name: 'demo',
          packageManager: 'pnpm@10.0.0',
          scripts: { test: 'vitest run' },
        },
        null,
        2,
      ),
      'utf-8',
    );
    await fs.writeFile(path.join(repoPath, 'bun.lock'), '', 'utf-8');

    const profile = await detectNodeRuntimeProfile(repoPath);
    expect(profile).toBeDefined();
    expect(profile?.packageManager).toBe('pnpm');
    expect(profile?.source).toBe('packageManager');
  });

  test('detects package manager from lockfile', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
      'utf-8',
    );
    await fs.writeFile(path.join(repoPath, 'yarn.lock'), '', 'utf-8');

    const profile = await detectNodeRuntimeProfile(repoPath);
    expect(profile).toBeDefined();
    expect(profile?.packageManager).toBe('yarn');
    expect(profile?.source).toBe('lockfile');
  });

  test('defaults to npm when no package manager hint exists', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
      'utf-8',
    );

    const profile = await detectNodeRuntimeProfile(repoPath);
    expect(profile).toBeDefined();
    expect(profile?.packageManager).toBe('npm');
    expect(profile?.source).toBe('default');
  });

  test('drops non-string scripts while keeping valid scripts', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            lint: 'eslint .',
            test: true,
          },
        },
        null,
        2,
      ),
      'utf-8',
    );

    const profile = await detectNodeRuntimeProfile(repoPath);
    expect(profile).toBeDefined();
    expect(profile?.scripts).toEqual({
      lint: 'eslint .',
    });
  });

  test('returns undefined when package.json is invalid', async () => {
    await fs.writeFile(path.join(repoPath, 'package.json'), '{ invalid-json', 'utf-8');

    expect(await detectNodeRuntimeProfile(repoPath)).toBeUndefined();
  });
});
