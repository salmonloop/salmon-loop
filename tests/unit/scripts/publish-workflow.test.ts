import { readFile } from 'fs/promises';
import path from 'path';

import { describe, expect, it } from 'bun:test';
import { parse } from 'yaml';

const repoRoot = path.resolve(import.meta.dir, '..', '..', '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'publish.yml');

function findStep(steps: any[], name: string) {
  return steps.find((step) => step?.name === name);
}

describe('publish workflow', () => {
  it('uses OIDC for tag publish and token fallback for manual dispatch', async () => {
    const raw = await readFile(workflowPath, 'utf8');
    const workflow = parse(raw) as any;

    const publishJob = workflow?.jobs?.publish;
    expect(publishJob).toBeTruthy();
    expect(publishJob.permissions?.['id-token']).toBe('write');

    const steps = publishJob.steps as any[];
    expect(Array.isArray(steps)).toBe(true);

    const oidc = findStep(steps, 'Publish (OIDC)');
    const token = findStep(steps, 'Publish (token fallback)');

    expect(oidc?.if).toBe("github.event_name == 'push'");
    expect(String(oidc?.run || '')).toContain('npm publish');
    expect(String(oidc?.run || '')).not.toContain('--provenance');

    expect(token?.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(token?.env?.NODE_AUTH_TOKEN).toBe('${{ secrets.NPM_TOKEN }}');
    expect(String(token?.run || '')).toContain('npm publish');
  });
});
