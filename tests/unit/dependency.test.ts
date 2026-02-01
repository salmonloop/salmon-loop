import { readFile } from 'fs/promises';

import { findFileDependencies } from '../../src/core/dependency.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../../src/core/plugin/registry.js', () => ({
  pluginRegistry: {
    getByExtension: vi.fn().mockReturnValue({
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
      import { a } from './a';
      import { b } from '../b';
      import { c } from 'external';
    `;
    vi.mocked(readFile).mockResolvedValue(content);

    const deps = await findFileDependencies('src/index.ts', '/repo');

    expect(deps).toContain('src/a.ts');
    expect(deps).toContain('b.ts');
    expect(deps).not.toContain('external.ts');
  });

  it('should handle missing extensions', async () => {
    const content = `import { a } from './a'`;
    vi.mocked(readFile).mockResolvedValue(content);

    const deps = await findFileDependencies('src/index.ts', '/repo');
    expect(deps).toContain('src/a.ts');
  });

  it('should return empty array on error', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('File not found'));

    const deps = await findFileDependencies('missing.ts', '/repo');
    expect(deps).toEqual([]);
  });
});
