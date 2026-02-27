import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { resolveWorktreePrepareOption } from '../../../../src/cli/utils/worktree-prepare-resolver.js';

describe('resolveWorktreePrepareOption', () => {
  let repoPath = '';

  beforeEach(async () => {
    repoPath = await fs.mkdtemp(path.join(os.tmpdir(), 'salmon-loop-prepare-resolver-'));
  });

  afterEach(async () => {
    if (repoPath) {
      await fs.rm(repoPath, { recursive: true, force: true });
    }
  });

  it('prefers explicit CLI worktree prepare command', async () => {
    await expect(
      resolveWorktreePrepareOption(repoPath, 'worktree', 'custom prepare command'),
    ).resolves.toBe('custom prepare command');
  });

  it('returns undefined when strategy is direct', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ scripts: {} }, null, 2),
      'utf-8',
    );

    await expect(
      resolveWorktreePrepareOption(repoPath, 'direct', undefined),
    ).resolves.toBeUndefined();
  });

  it('auto-detects prepare command in worktree strategy', async () => {
    await fs.writeFile(
      path.join(repoPath, 'package.json'),
      JSON.stringify({ scripts: {} }, null, 2),
      'utf-8',
    );
    await fs.writeFile(path.join(repoPath, 'bun.lock'), '', 'utf-8');

    await expect(resolveWorktreePrepareOption(repoPath, 'worktree', undefined)).resolves.toBe(
      'bun install --frozen-lockfile',
    );
  });
});
