import { describe, expect, it } from 'bun:test';

import { TargetResolver } from '../../../src/core/context/targeting/target-resolver.js';
import type { ContextRequest } from '../../../src/core/context/types.js';
import type { SymbolMap } from '../../../src/core/types/context.js';

describe('Symbol diffusion source tracking', () => {
  it('tracks hits from definitionMap vs symbolMap in audit metrics', async () => {
    const resolver = new TargetResolver();

    const definitionMap = {
      helper: { start: { line: 1, column: 10 }, end: { line: 3, column: 1 } },
    };

    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:utility:5:10',
          name: 'utility',
          kind: 'definition',
          path: 'utils.ts',
          location: { start: { line: 5, column: 10 }, end: { line: 7, column: 1 } },
        },
      ],
      edges: [],
    };

    const req: ContextRequest = {
      instruction: 'fix helper and utility functions',
      primaryFile: 'main.ts',
      repoPath: '/test',
    };

    const result = await resolver.resolve({
      req,
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      definitionMap,
      symbolMap,
      diffusionDepth: 1,
    });

    expect(result.diffusionMetrics).toBeDefined();
    expect(result.diffusionMetrics?.sourceBreakdown).toBeDefined();
    expect(result.diffusionMetrics?.sourceBreakdown?.fromDefinitionMap).toBeGreaterThan(0);
    expect(result.diffusionMetrics?.sourceBreakdown?.fromSymbolMap).toBeGreaterThan(0);
  });

  it('counts only symbolMap hits when definitionMap is empty', async () => {
    const resolver = new TargetResolver();

    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:foo:1:10',
          name: 'foo',
          kind: 'definition',
          path: 'lib.ts',
          location: { start: { line: 1, column: 10 }, end: { line: 3, column: 1 } },
        },
        {
          id: 'def:bar:5:10',
          name: 'bar',
          kind: 'definition',
          path: 'lib.ts',
          location: { start: { line: 5, column: 10 }, end: { line: 7, column: 1 } },
        },
      ],
      edges: [],
    };

    const req: ContextRequest = {
      instruction: 'fix foo and bar',
      primaryFile: 'main.ts',
      repoPath: '/test',
    };

    const result = await resolver.resolve({
      req,
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      definitionMap: {},
      symbolMap,
      diffusionDepth: 1,
    });

    expect(result.diffusionMetrics?.sourceBreakdown?.fromDefinitionMap).toBe(0);
    expect(result.diffusionMetrics?.sourceBreakdown?.fromSymbolMap).toBeGreaterThan(0);
  });

  it('counts only definitionMap hits when symbolMap is empty', async () => {
    const resolver = new TargetResolver();

    const definitionMap = {
      foo: { start: { line: 1, column: 10 }, end: { line: 3, column: 1 } },
      bar: { start: { line: 5, column: 10 }, end: { line: 7, column: 1 } },
    };

    const req: ContextRequest = {
      instruction: 'fix foo and bar',
      primaryFile: 'main.ts',
      repoPath: '/test',
    };

    const result = await resolver.resolve({
      req,
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      definitionMap,
      symbolMap: { nodes: [], edges: [] },
      diffusionDepth: 1,
    });

    expect(result.diffusionMetrics?.sourceBreakdown?.fromDefinitionMap).toBeGreaterThan(0);
    expect(result.diffusionMetrics?.sourceBreakdown?.fromSymbolMap).toBe(0);
  });
});
