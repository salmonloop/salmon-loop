import { describe, expect, it, mock } from 'bun:test';

import { checkPatchApplies } from '../../../../../../src/core/grizzco/steps/patch/apply-check.js';

describe('patch/apply-check', () => {
  it('delegates to git apply --check with deterministic limits', async () => {
    const execMeta = mock(async () => ({ ok: true, stderr: '' }));

    const out = await checkPatchApplies(
      {
        repoRoot: '/tmp/repo',
        diff: 'diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+b\n',
      },
      {
        createGitAdapter: () => ({ execMeta }) as any,
      },
    );

    expect(out.ok).toBe(true);
    expect(execMeta).toHaveBeenCalledTimes(1);
    expect(execMeta).toHaveBeenCalledWith(
      ['apply', '--check', '--recount', '--ignore-whitespace', '--whitespace=nowarn', '-'],
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });
});
