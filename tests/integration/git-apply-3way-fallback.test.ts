import { readFile } from 'fs/promises';

import { GitAdapter } from '../../src/core/adapters/git/git-adapter';
import { RealFsTestHelper } from '../helpers/real-fs-helper';

describe('GitAdapter.applyPatch 3-way fallback behavior', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    await helper.cleanup();
  });

  it('should fall back to non-3-way apply when index blobs are missing (LLM-style fake index)', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        {
          path: 'src/index.js',
          content: ['function createSafeEnvProxy(env) {', '  return env;', '}', ''].join('\n'),
        },
      ],
    });

    const git = new GitAdapter(repo.path);

    const diff = [
      'diff --git a/src/index.js b/src/index.js',
      'index deadbeef..beefcafe 100644',
      '--- a/src/index.js',
      '+++ b/src/index.js',
      '@@ -1,3 +1,4 @@',
      ' function createSafeEnvProxy(env) {',
      '+  // test',
      '   return env;',
      ' }',
      '',
    ].join('\n');

    await git.applyPatch(diff, { threeWay: true, ignoreWhitespace: true });

    const updated = await readFile(`${repo.path}/src/index.js`, 'utf-8');
    expect(updated).toContain('// test');
  });
});
