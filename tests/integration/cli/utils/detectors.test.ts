import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { autoDetectVerifyCommand } from '../../../../src/cli/utils/detectors/index.js';

describe('autoDetectVerifyCommand', () => {
  let repoPath = '';

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'salmon-loop-detector-'));
  });

  afterEach(async () => {
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true });
    }
  });

  it('detects bun command from bun lockfile', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
      'utf-8',
    );
    await fs.writeFile(path.join(repoPath, 'bun.lock'), '', 'utf-8');

    await expect(autoDetectVerifyCommand(repoPath)).resolves.toBe('bun run test');
  });

  it('detects pnpm command from lockfile', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
      'utf-8',
    );
    await fs.writeFile(path.join(repoPath, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0', 'utf-8');

    await expect(autoDetectVerifyCommand(repoPath)).resolves.toBe('pnpm run test');
  });

  it('detects yarn command from packageManager field', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify(
        {
          packageManager: 'yarn@4.6.0',
          scripts: { test: 'vitest run' },
        },
        null,
        2,
      ),
      'utf-8',
    );

    await expect(autoDetectVerifyCommand(repoPath)).resolves.toBe('yarn run test');
  });

  it('defaults to npm when no package manager hint exists', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }, null, 2),
      'utf-8',
    );

    await expect(autoDetectVerifyCommand(repoPath)).resolves.toBe('npm run test');
  });

  it('returns undefined when test script is missing', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ scripts: { lint: 'eslint .' } }, null, 2),
      'utf-8',
    );

    await expect(autoDetectVerifyCommand(repoPath)).resolves.toBeUndefined();
  });

  it('returns undefined when package.json is invalid', async () => {
    await fs.writeFile(path.join(repoPath, 'package.json'), '{invalid-json', 'utf-8');
    await expect(autoDetectVerifyCommand(repoPath)).resolves.toBeUndefined();
  });
});
