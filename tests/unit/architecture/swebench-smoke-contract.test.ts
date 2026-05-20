import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'bun:test';

describe('SWE-bench smoke harness contract', () => {
  it('keeps the SWE-bench smoke runner available as a package script', async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), 'package.json'), 'utf-8'),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.['smoke:swebench']).toBe('bun scripts/swebench-smoke.ts');
  });

  it('documents the layered quality outcomes instead of treating flow success as quality', async () => {
    const docs = await readFile(path.join(process.cwd(), 'docs/reference/headless.md'), 'utf-8');

    expect(docs).toContain('SWE-bench Smoke Harness');
    expect(docs).toContain('flowSuccess');
    expect(docs).toContain('reproductionPrepared');
    expect(docs).toContain('patchApplyable');
    expect(docs).toContain('behaviorVerified');
    expect(docs).toContain('regressionVerified');
    expect(docs).toContain('WEAK_VERIFY_COMMAND');
  });

  it('keeps the smoke runner CLI surface limited to active benchmark inputs', async () => {
    const script = await readFile(path.join(process.cwd(), 'scripts/swebench-smoke.ts'), 'utf-8');

    expect(script).toContain('--source-repo');
    expect(script).toContain('--cleanup');
    expect(script).not.toContain("token === '--repo'");
    expect(script).not.toContain("token === '--base-commit'");
    expect(script).not.toContain('--keep');
  });

  it('documents durable report artifacts by default', async () => {
    const docs = await readFile(path.join(process.cwd(), 'docs/reference/headless.md'), 'utf-8');

    expect(docs).toContain('keeps its output directory by default');
    expect(docs).toContain('--cleanup');
    expect(docs).not.toContain('--keep');
  });
});
