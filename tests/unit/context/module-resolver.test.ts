import { resolveImportCandidates } from '../../../src/core/context/ast/module-resolver.js';

describe('resolveImportCandidates', () => {
  it('returns empty candidates for non-relative specifiers', () => {
    expect(resolveImportCandidates({ currentFile: 'src/a.ts', specifier: 'react' }).length).toBe(0);
  });

  it('expands relative specifiers without extension', () => {
    const out = resolveImportCandidates({ currentFile: 'src/a.ts', specifier: './b' });
    expect(out).toContain('src/b.ts');
    expect(out).toContain('src/b.tsx');
    expect(out).toContain('src/b/index.ts');
  });

  it('adds .ts mapping for .js specifiers', () => {
    const out = resolveImportCandidates({ currentFile: 'src/a.ts', specifier: './b.js' });
    expect(out).toEqual(['src/b.js', 'src/b.ts']);
  });
});
