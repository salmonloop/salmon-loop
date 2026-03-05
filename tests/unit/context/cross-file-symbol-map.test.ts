import { describe, expect, it, beforeEach } from 'bun:test';

import { AstParser } from '../../../src/core/ast/parser.js';
import { AstGatherer } from '../../../src/core/context/gatherers/ast-gatherer.js';
import type { ContextRequest } from '../../../src/core/context/types.js';
import { getPluginRegistry } from '../../../src/core/plugin/registry.js';

mock.module('../../../src/core/ast/parser.js', () => ({
  AstParser: {
    parse: mock(),
    identifyDefinitions: mock(),
    identifyReferences: mock(),
  },
}));

describe('Cross-file symbol map extraction', () => {
  beforeEach(() => {
    const registry = getPluginRegistry();
    spyOn(registry, 'getByExtension').mockReturnValue({
      meta: { id: 'typescript', name: 'TypeScript', extensions: ['.ts'] },
    } as any);

    // Mock AstParser methods
    (AstParser.parse as unknown as ReturnType<typeof mock>).mockResolvedValue({});
  });

  it('extracts symbols from imported files', async () => {
    let parseCallCount = 0;

    // Mock to return different symbols based on which file is being parsed
    (AstParser.identifyDefinitions as unknown as ReturnType<typeof mock>).mockImplementation(
      async () => {
        parseCallCount++;
        if (parseCallCount === 1) {
          // Primary file: main.ts
          return [
            {
              name: 'main',
              kind: 'definition',
              location: { start: { line: 4, column: 10 }, end: { line: 6, column: 1 } },
            },
          ];
        } else {
          // Imported file: utils.ts
          return [
            {
              name: 'helper',
              kind: 'definition',
              location: { start: { line: 2, column: 17 }, end: { line: 4, column: 1 } },
            },
            {
              name: 'utility',
              kind: 'definition',
              location: { start: { line: 6, column: 10 }, end: { line: 8, column: 1 } },
            },
          ];
        }
      },
    );

    (AstParser.identifyReferences as unknown as ReturnType<typeof mock>).mockResolvedValue([
      {
        name: 'helper',
        kind: 'reference',
        location: { start: { line: 5, column: 3 }, end: { line: 5, column: 9 } },
      },
    ]);

    const primaryText = `
import { helper } from './utils.js';

function main() {
  helper();
}
`;

    const utilsText = `
export function helper() {
  return utility();
}

function utility() {
  return 42;
}
`;

    const req: ContextRequest = {
      instruction: 'test helper',
      primaryFile: 'main.ts',
      repoPath: '/test',
      checkpointManager: {
        readSnapshotFile: async (_repoPath: string, _hash: string, path: string) => {
          if (path === 'utils.ts') return utilsText;
          throw new Error('File not found');
        },
      } as any,
      snapshotHash: 'test-hash',
    };

    const gatherer = new AstGatherer();
    const result = await gatherer.gather(primaryText, req);

    // Should have nodes from both files
    const mainNodes = result.symbolMap?.nodes.filter((n) => n.path === 'main.ts') || [];
    const utilsNodes = result.symbolMap?.nodes.filter((n) => n.path === 'utils.ts') || [];

    expect(mainNodes.length).toBeGreaterThan(0);
    expect(utilsNodes.length).toBeGreaterThan(0);

    // Should have helper definition from utils.ts
    const helperDef = utilsNodes.find((n) => n.name === 'helper' && n.kind === 'definition');
    expect(helperDef).toBeDefined();
    expect(helperDef?.path).toBe('utils.ts');

    // Should have utility definition from utils.ts
    const utilityDef = utilsNodes.find((n) => n.name === 'utility' && n.kind === 'definition');
    expect(utilityDef).toBeDefined();
    expect(utilityDef?.path).toBe('utils.ts');
  });

  it('preserves real file paths in symbol nodes', async () => {
    let parseCallCount = 0;

    (AstParser.identifyDefinitions as unknown as ReturnType<typeof mock>).mockImplementation(
      async () => {
        parseCallCount++;
        if (parseCallCount === 1) {
          // Primary file: src/index.ts
          return [];
        } else {
          // Imported file: src/lib/foo.ts
          return [
            {
              name: 'foo',
              kind: 'definition',
              location: { start: { line: 2, column: 17 }, end: { line: 4, column: 1 } },
            },
            {
              name: 'bar',
              kind: 'definition',
              location: { start: { line: 6, column: 10 }, end: { line: 8, column: 1 } },
            },
          ];
        }
      },
    );

    (AstParser.identifyReferences as unknown as ReturnType<typeof mock>).mockResolvedValue([
      {
        name: 'foo',
        kind: 'reference',
        location: { start: { line: 3, column: 1 }, end: { line: 3, column: 4 } },
      },
    ]);
    const primaryText = `
import { foo } from './lib/foo.js';

foo();
`;

    const fooText = `
export function foo() {
  return bar();
}

function bar() {
  return 1;
}
`;

    const req: ContextRequest = {
      instruction: 'test foo',
      primaryFile: 'src/index.ts',
      repoPath: '/test',
      checkpointManager: {
        readSnapshotFile: async (_repoPath: string, _hash: string, path: string) => {
          if (path === 'src/lib/foo.ts') return fooText;
          throw new Error('File not found');
        },
      } as any,
      snapshotHash: 'test-hash',
    };

    const gatherer = new AstGatherer();
    const result = await gatherer.gather(primaryText, req);

    const fooNodes = result.symbolMap?.nodes.filter((n) => n.path === 'src/lib/foo.ts') || [];
    expect(fooNodes.length).toBeGreaterThan(0);

    const fooDef = fooNodes.find((n) => n.name === 'foo' && n.kind === 'definition');
    expect(fooDef?.path).toBe('src/lib/foo.ts');
  });
});
