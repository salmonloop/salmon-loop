import { findFileDependencies } from '../../src/core/context/dependencies.js';
import { getPluginRegistry } from '../../src/core/plugin/registry.js';

const readFileMock = mock();

describe('findFileDependencies', () => {
  beforeEach(() => {
    const registry = getPluginRegistry();
    spyOn(registry, 'getByExtension').mockReturnValue({
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
    } as any);
  });

  afterEach(() => {
    mock.restore();
  });

  it('should extract relative dependencies', async () => {
    const content = `
      import { a } from './a.js';
      import { b } from '../b.js';
      import { c } from 'external';
    `;
    readFileMock.mockResolvedValue(content);

    const deps = await findFileDependencies('src/index.ts', '/repo', undefined, {
      fileAdapter: { readFile: readFileMock },
    });

    expect(deps).toContain('src/a.js');
    expect(deps).toContain('b.js');
    expect(deps).not.toContain('external.ts');
  });

  it('should handle missing extensions', async () => {
    const content = `import { a } from './a.js';`;
    readFileMock.mockResolvedValue(content);

    const deps = await findFileDependencies('src/index.ts', '/repo', undefined, {
      fileAdapter: { readFile: readFileMock },
    });
    expect(deps).toContain('src/a.js');
  });

  it('should return empty array on error', async () => {
    readFileMock.mockRejectedValue(new Error('File not found'));

    const deps = await findFileDependencies('missing.ts', '/repo', undefined, {
      fileAdapter: { readFile: readFileMock },
    });
    expect(deps).toEqual([]);
  });
});
