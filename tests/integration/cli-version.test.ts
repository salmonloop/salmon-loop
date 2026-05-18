import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'bun:test';

import { runCli } from '../helpers/cli-runner.js';

describe('CLI version output', () => {
  it('prints the package version for --version', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { version: string };

    const result = await runCli(['--version']);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(packageJson.version);
  });
});
