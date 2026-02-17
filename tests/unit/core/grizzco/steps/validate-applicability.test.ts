import { afterEach, describe, expect, it } from 'vitest';

import { validatePatch } from '../../../../../src/core/grizzco/steps/validate.js';
import { normalizeDiff, validateDiff } from '../../../../../src/core/patch/diff.js';
import { PatchNotApplicableError } from '../../../../../src/core/types/index.js';
import { RealFsTestHelper } from '../../../../helpers/real-fs-helper.js';

describe('VALIDATE (patch applicability)', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('fails early when git apply --check reports the patch does not apply', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'a.txt', content: 'hello\n' }],
    });

    const diff =
      'diff --git a/a.txt b/a.txt\n' +
      '--- a/a.txt\n' +
      '+++ b/a.txt\n' +
      '@@ -1,1 +1,1 @@\n' +
      '-HELLO\n' +
      '+world\n';

    const normalized = normalizeDiff(diff);
    const diffMeta = validateDiff(normalized);

    await expect(
      validatePatch({
        diff: normalized,
        diffMeta,
        workspace: { workPath: repo.path },
        emit: () => {},
      } as any),
    ).rejects.toBeInstanceOf(PatchNotApplicableError);
  });
});
