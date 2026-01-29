import { convertDiffToShadowOperations } from '../../src/core/diff';

describe('convertDiffToShadowOperations', () => {
  it('should support unified diffs without diff --git header (---/+++ only)', async () => {
    const diff = [
      '--- a/src/index.js',
      '+++ b/src/index.js',
      '@@ -1,3 +1,4 @@',
      ' function createSafeEnvProxy(env) {',
      '+  // test',
      '   return env;',
      ' }',
      '',
    ].join('\n');

    const ops = await convertDiffToShadowOperations(diff);
    expect(ops).toHaveLength(1);
    const op = ops[0];
    if (!op) {
      throw new Error('Expected exactly one operation');
    }
    expect(op.path).toBe('src/index.js');

    if (!op.content) {
      throw new Error('Expected operation to contain patch content');
    }
    const content = op.content.toString('utf8');
    expect(content.startsWith('diff --git a/src/index.js b/src/index.js')).toBe(true);
  });
});
