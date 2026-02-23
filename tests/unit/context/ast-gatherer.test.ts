import { readFile } from 'fs/promises';

import { AstGatherer } from '../../../src/core/context/gatherers/ast-gatherer.js';
import type { ContextRequest } from '../../../src/core/context/types.js';
import { pluginRegistry } from '../../../src/core/plugin/registry.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('AstGatherer import traversal', () => {
  beforeEach(() => {
    vi.spyOn(pluginRegistry, 'getAll').mockReturnValue([
      {
        meta: { id: 'ts', name: 'TypeScript', extensions: ['.ts'] },
      } as any,
    ]);

    const readFileMock = readFile as unknown as ReturnType<typeof vi.fn>;
    readFileMock.mockImplementation(async (filePath: any) => {
      const p = String(filePath);
      if (p.endsWith('/b.ts')) {
        return "import { c } from './c';\nexport const b = c;\n";
      }
      if (p.endsWith('/c.ts')) {
        return 'export const c = 1;\n';
      }
      throw new Error(`ENOENT: ${p}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps one-hop import traversal in shallow mode', async () => {
    const gatherer = new AstGatherer();
    const req: ContextRequest = {
      instruction: 'fix bug in a.ts',
      repoPath: '/repo',
      primaryFile: 'a.ts',
    };
    const result = await gatherer.gather("import { b } from './b';\n", req);

    expect(result.repoMap?.trigger).toBe('shallow');
    expect(result.repoMap?.maxDepth).toBe(1);
    expect(result.relatedFiles.some((f) => f.path === 'b.ts')).toBe(true);
    expect(result.relatedFiles.some((f) => f.path === 'c.ts')).toBe(false);
  });

  it('expands traversal depth when deep trigger keywords appear', async () => {
    const gatherer = new AstGatherer();
    const req: ContextRequest = {
      instruction: 'refactor cross-file module boundaries for a.ts',
      repoPath: '/repo',
      primaryFile: 'a.ts',
    };
    const result = await gatherer.gather("import { b } from './b';\n", req);

    expect(result.repoMap?.trigger).toBe('deep');
    expect((result.repoMap?.nodes || []).some((n) => n.path === 'c.ts')).toBe(true);
    expect(result.relatedFiles.some((f) => f.path === 'c.ts')).toBe(true);
  });
});
