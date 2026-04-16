import { readFile } from 'fs/promises';
import { join } from 'path';

import { describe, expect, it } from 'bun:test';

interface PackageJsonScripts {
  verify?: string;
  'test:ci'?: string;
  'test:contract-smoke'?: string;
}

interface PackageJsonShape {
  scripts?: PackageJsonScripts;
}

async function readPackageScripts(): Promise<PackageJsonScripts> {
  const packageJson = await readFile(join(process.cwd(), 'package.json'), 'utf8');
  const parsed = JSON.parse(packageJson) as PackageJsonShape;
  return parsed.scripts ?? {};
}

describe('architecture/verify contract smoke gate', () => {
  it('verify includes contract smoke before full tests', async () => {
    const scripts = await readPackageScripts();
    const verifyScript = scripts.verify ?? '';

    expect(verifyScript).toContain('bun run test:contract-smoke');
    expect(verifyScript).toContain('bun run test:full');
    expect(verifyScript.indexOf('bun run test:contract-smoke')).toBeLessThan(
      verifyScript.indexOf('bun run test:full'),
    );
  });

  it('ci verify path goes through verify script', async () => {
    const scripts = await readPackageScripts();
    expect(scripts['test:ci']).toBe('bun run verify');
  });

  it('contract smoke suite includes core context-engineering invariant tests', async () => {
    const scripts = await readPackageScripts();
    const smokeScript = scripts['test:contract-smoke'] ?? '';

    expect(smokeScript).toContain('tests/unit/architecture/request-assembly-invariant.test.ts');
    expect(smokeScript).toContain(
      'tests/unit/architecture/replacement-preview-boundary-invariant.test.ts',
    );
    expect(smokeScript).toContain('tests/unit/tools/session-streaming.test.ts');
    expect(smokeScript).toContain('tests/unit/core/grizzco/steps/plan-patch-toolcalling.test.ts');
  });
});
