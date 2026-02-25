import { readFile } from 'fs/promises';

import { findFileDependencies } from '../../src/core/context/dependencies.js';

mock.module('fs/promises', () => ({
  readFile: mock(),
}));

mock.module('../../src/core/plugin/registry.js', () => ({
  pluginRegistry: {
    getByExtension: mock().mockReturnValue({
      dependency: {
        extractImports: (content: string) => {
          const matches = [
            ...content.matchAll(/import\s+(?:{[\s\S]*?}|.*?)\s+from\s+['"]([^'"]+)['"]/g),
          ];
          return matches.map((m) => m[1]);
        },
        resolvePath: (_dir: string, imp: string) => {
          if (imp.startsWith('.')) {
            return imp.endsWith('.ts') || imp.endsWith('.js') ? imp : `${imp}.ts`;
          }
          return imp;
        },
      },
    }),
  },
}));

describe('findFileDependencies', () => {
  it('should extract relative dependencies', async () => {
    const content = `
      import { a } from './a.js';
      import { b } from '../b.js';
      import { c } from 'external';
    `;
    (readFile as any).mockResolvedValue(content);

    const deps = await findFileDependencies('src/index.ts', '/repo');

    expect(deps).toContain('src/a.js');
    expect(deps).toContain('b.js');
    expect(deps).not.toContain('external.ts');
  });

  it('should handle missing extensions', async () => {
    const content = `import { a } from './a.js';`;
    (readFile as any).mockResolvedValue(content);

    const deps = await findFileDependencies('src/index.ts', '/repo');
    expect(deps).toContain('src/a.js');
  });

  it('should return empty array on error', async () => {
    (readFile as any).mockRejectedValue(new Error('File not found'));

    const deps = await findFileDependencies('missing.ts', '/repo');
    expect(deps).toEqual([]);
  });
});
