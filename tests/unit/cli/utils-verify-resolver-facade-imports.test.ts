import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'bun:test';

describe('cli utils verify-resolver import boundary', () => {
  it('utils/verify-resolver.ts should not directly import from ../../core/*', async () => {
    const file = path.resolve(process.cwd(), 'src/cli/utils/verify-resolver.ts');
    const content = await readFile(file, 'utf8');
    const directCoreImports = content
      .split('\n')
      .filter((line) => line.includes("from '../../core/"))
      .filter((line) => !line.includes("from '../../core/facades/"));

    expect(directCoreImports).toEqual([]);
  });
});
