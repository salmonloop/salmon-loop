import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ContextService } from '../../src/core/context/service.js';
import { RealFsTestHelper } from '../helpers/real-fs-helper.js';

describe('ContextService Integration', () => {
  const helper = new RealFsTestHelper();
  let repoPath: string;

  beforeEach(async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [
        {
          path: 'src/a.ts',
          content: "import { b } from './b';\n\nexport function a() {\n  return b();\n}\n",
        },
        {
          path: 'src/b.ts',
          content: 'export function b() {\n  return 1;\n}\n',
        },
      ],
    });
    repoPath = repo.path;
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  it('includes dependency diffs in ast_related scope', async () => {
    await helper.writeFile(repoPath, 'src/b.ts', 'export function b() {\n  return 2;\n}\n');

    const service = new ContextService();
    const result = await service.build({
      instruction: 'hi',
      repoPath,
      primaryFile: 'src/a.ts',
      diffScope: 'ast_related',
    });

    expect(result.context.unstagedDiff || '').toContain('src/b.ts');
    expect(result.meta.diffScope).toBe('ast_related');
  });
});
