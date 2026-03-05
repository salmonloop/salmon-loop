import { AstParser } from '../../../src/core/ast/parser.js';
import { AstGatherer } from '../../../src/core/context/gatherers/ast-gatherer.js';
import type { ContextRequest } from '../../../src/core/context/types.js';
import { getPluginRegistry } from '../../../src/core/plugin/registry.js';

const readFileMock = mock();

mock.module('../../../src/core/adapters/fs/file-adapter.js', () => ({
  FileAdapter: class {
    readFile = readFileMock;
    stat = mock();
    exists = mock().mockResolvedValue(false);
    readdir = mock().mockResolvedValue([]);
    mkdir = mock();
    writeFile = mock();
    deleteFile = mock();
  },
}));
mock.module('../../../src/core/ast/parser.js', () => ({
  AstParser: {
    parse: mock(),
    identifyDefinitions: mock(),
    identifyReferences: mock(),
    queryCapturesFromQuery: mock(),
  },
}));

describe('AstGatherer import traversal', () => {
  beforeEach(() => {
    const registry = getPluginRegistry();
    spyOn(registry, 'getAll').mockReturnValue([
      {
        meta: { id: 'ts', name: 'TypeScript', extensions: ['.ts'] },
      } as any,
    ]);
    spyOn(registry, 'getByExtension').mockReturnValue({
      meta: { id: 'ts', name: 'TypeScript', extensions: ['.ts'] },
    } as any);

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

    (AstParser.parse as unknown as ReturnType<typeof mock>).mockResolvedValue({});
    (AstParser.identifyDefinitions as unknown as ReturnType<typeof mock>).mockResolvedValue([
      {
        name: 'foo',
        kind: 'definition',
        location: { start: { line: 1, column: 1 }, end: { line: 1, column: 4 } },
      },
    ]);
    (AstParser.identifyReferences as unknown as ReturnType<typeof mock>).mockResolvedValue([
      {
        name: 'foo',
        kind: 'reference',
        location: { start: { line: 2, column: 3 }, end: { line: 2, column: 6 } },
        snippet: 'foo()',
      },
    ]);
    (AstParser.queryCapturesFromQuery as unknown as ReturnType<typeof mock>).mockResolvedValue([]);
  });

  afterEach(() => {
    mock.restore();
  });

  it('keeps one-hop import traversal in shallow mode', async () => {
    const gatherer = new AstGatherer();
    const req: ContextRequest = {
      instruction: 'fix bug in a.ts',
      repoPath: '/repo',
      primaryFile: 'a.ts',
    };
    const result = await gatherer.gather("import { b } from './b';\nif (x) { throw err }\n", req);

    expect(result.repoMap?.trigger).toBe('shallow');
    expect(result.repoMap?.maxDepth).toBe(1);
    expect(result.relatedFiles.some((f) => f.path === 'b.ts')).toBe(true);
    expect(result.relatedFiles.some((f) => f.path === 'c.ts')).toBe(false);
    expect(result.symbolMap?.nodes.some((n) => n.name === 'foo')).toBe(true);
    expect(result.symbolMap?.edges.some((e) => e.type === 'reference')).toBe(true);
    expect(result.controlFlow?.branchCount).toBeGreaterThan(0);
    expect(result.exceptionPaths?.throwCount).toBeGreaterThan(0);
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

  it('uses plugin queryPack for call graph and flow summaries when available', async () => {
    const registry = getPluginRegistry();
    spyOn(registry, 'getByExtension').mockReturnValue({
      meta: { id: 'ts', name: 'TypeScript', extensions: ['.ts'] },
      parsing: {
        queryPack: {
          symbols: { calls: '(call_expression function: (identifier) @callee)' },
          flow: { control: '(if_statement) @branch', exceptions: '(throw_statement) @throw' },
        },
      },
    } as any);

    (AstParser.queryCapturesFromQuery as unknown as ReturnType<typeof mock>)
      .mockResolvedValueOnce([{ name: 'callee', text: 'foo', line: 2, column: 1 }])
      .mockResolvedValueOnce([{ name: 'branch', text: 'if', line: 2, column: 1 }])
      .mockResolvedValueOnce([{ name: 'throw', text: 'throw', line: 3, column: 1 }]);

    const gatherer = new AstGatherer();
    const req: ContextRequest = {
      instruction: 'fix foo',
      repoPath: '/repo',
      primaryFile: 'a.ts',
    };
    const result = await gatherer.gather('foo();\nif (x) throw e;\n', req);

    expect(result.symbolMap?.edges.some((e) => e.type === 'call')).toBe(true);
    expect(result.controlFlow?.branchCount).toBe(1);
    expect(result.exceptionPaths?.throwCount).toBe(1);
  });
});
