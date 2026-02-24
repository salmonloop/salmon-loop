import { describe, expect, it } from 'vitest';

import { TargetResolver } from '../../../src/core/context/targeting/target-resolver.js';
import type { SymbolMap } from '../../../src/core/types/index.js';

describe('Symbol diffusion budget limits', () => {
  it('enforces maximum number of diffusion targets', async () => {
    const resolver = new TargetResolver();

    // Create a symbol with many callers (more than budget)
    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:popular:10:1',
          name: 'popular',
          kind: 'definition',
          path: 'src/popular.ts',
          location: { start: { line: 10, column: 1 }, end: { line: 10, column: 8 } },
        },
        // Create 10 callers
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `ref:popular:${20 + i}:5`,
          name: 'popular',
          kind: 'reference' as const,
          path: `src/caller${i}.ts`,
          location: { start: { line: 20 + i, column: 5 }, end: { line: 20 + i, column: 13 } },
        })),
      ],
      edges: [
        // All callers have high confidence
        ...Array.from({ length: 10 }, (_, i) => ({
          from: `ref:popular:${20 + i}:5`,
          to: 'def:popular:10:1',
          type: 'call' as const,
          confidence: 'high' as const,
        })),
      ],
    };

    const res = await resolver.resolve({
      req: {
        instruction: 'fix `popular` function',
        repoPath: '/repo',
        primaryFile: 'src/popular.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      symbolMap,
      maxDiffusionTargets: 5, // Budget limit
    });

    // Should include primary + at most 5 callers
    const callerTargets = res.targets.filter((t) => t.path.startsWith('src/caller'));
    expect(callerTargets.length).toBeLessThanOrEqual(5);
  });

  it('respects budget when diffusion depth increases', async () => {
    const resolver = new TargetResolver();

    // Multi-level call graph:
    // target <- caller1 <- caller1-1
    //        <- caller2 <- caller2-1, caller2-2
    // Total potential targets: 1 (def) + 2 (level 1) + 3 (level 2) = 6

    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:target:10:1',
          name: 'target',
          kind: 'definition',
          path: 'src/target.ts',
          location: { start: { line: 10, column: 1 }, end: { line: 10, column: 7 } },
        },
        {
          id: 'ref:target:20:5',
          name: 'target',
          kind: 'reference',
          path: 'src/caller1.ts',
          location: { start: { line: 20, column: 5 }, end: { line: 20, column: 12 } },
        },
        {
          id: 'ref:target:30:10',
          name: 'target',
          kind: 'reference',
          path: 'src/caller2.ts',
          location: { start: { line: 30, column: 10 }, end: { line: 30, column: 17 } },
        },
        {
          id: 'def:caller1:5:1',
          name: 'caller1',
          kind: 'definition',
          path: 'src/caller1.ts',
          location: { start: { line: 5, column: 1 }, end: { line: 5, column: 8 } },
        },
        {
          id: 'ref:caller1:40:3',
          name: 'caller1',
          kind: 'reference',
          path: 'src/caller1-1.ts',
          location: { start: { line: 40, column: 3 }, end: { line: 40, column: 11 } },
        },
        {
          id: 'def:caller2:6:1',
          name: 'caller2',
          kind: 'definition',
          path: 'src/caller2.ts',
          location: { start: { line: 6, column: 1 }, end: { line: 6, column: 8 } },
        },
        {
          id: 'ref:caller2:50:5',
          name: 'caller2',
          kind: 'reference',
          path: 'src/caller2-1.ts',
          location: { start: { line: 50, column: 5 }, end: { line: 50, column: 13 } },
        },
        {
          id: 'ref:caller2:60:8',
          name: 'caller2',
          kind: 'reference',
          path: 'src/caller2-2.ts',
          location: { start: { line: 60, column: 8 }, end: { line: 60, column: 16 } },
        },
      ],
      edges: [
        { from: 'ref:target:20:5', to: 'def:target:10:1', type: 'call', confidence: 'high' },
        { from: 'ref:target:30:10', to: 'def:target:10:1', type: 'call', confidence: 'high' },
        { from: 'ref:caller1:40:3', to: 'def:caller1:5:1', type: 'call', confidence: 'high' },
        { from: 'ref:caller2:50:5', to: 'def:caller2:6:1', type: 'call', confidence: 'high' },
        { from: 'ref:caller2:60:8', to: 'def:caller2:6:1', type: 'call', confidence: 'high' },
      ],
    };

    const res = await resolver.resolve({
      req: {
        instruction: 'refactor `target` and all callers',
        repoPath: '/repo',
        primaryFile: 'src/target.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      symbolMap,
      diffusionDepth: 2,
      maxDiffusionTargets: 3, // Budget limit
    });

    // Should respect budget even with depth 2
    const allTargets = res.targets.filter((t) => t.reason === 'symbol_definition');
    expect(allTargets.length).toBeLessThanOrEqual(4); // 1 primary + 3 diffusion
  });

  it('counts budget per symbol, not per file', async () => {
    const resolver = new TargetResolver();

    // One file can have multiple references to the same symbol
    // Budget should count unique symbols, not files

    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:foo:10:1',
          name: 'foo',
          kind: 'definition',
          path: 'src/foo.ts',
          location: { start: { line: 10, column: 1 }, end: { line: 10, column: 4 } },
        },
        {
          id: 'ref:foo:20:5',
          name: 'foo',
          kind: 'reference',
          path: 'src/user.ts',
          location: { start: { line: 20, column: 5 }, end: { line: 20, column: 8 } },
        },
        {
          id: 'ref:foo:30:10',
          name: 'foo',
          kind: 'reference',
          path: 'src/user.ts', // Same file, different location
          location: { start: { line: 30, column: 10 }, end: { line: 30, column: 13 } },
        },
      ],
      edges: [
        { from: 'ref:foo:20:5', to: 'def:foo:10:1', type: 'call', confidence: 'high' },
        { from: 'ref:foo:30:10', to: 'def:foo:10:1', type: 'call', confidence: 'high' },
      ],
    };

    const res = await resolver.resolve({
      req: {
        instruction: 'fix `foo`',
        repoPath: '/repo',
        primaryFile: 'src/foo.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      symbolMap,
      maxDiffusionTargets: 5,
    });

    // Should include user.ts once (deduped), not twice
    const userTargets = res.targets.filter((t) => t.path === 'src/user.ts');
    expect(userTargets.length).toBe(1);
  });

  it('provides budget usage metrics in result', async () => {
    const resolver = new TargetResolver();

    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:func:10:1',
          name: 'func',
          kind: 'definition',
          path: 'src/func.ts',
          location: { start: { line: 10, column: 1 }, end: { line: 10, column: 5 } },
        },
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `ref:func:${20 + i}:5`,
          name: 'func',
          kind: 'reference' as const,
          path: `src/caller${i}.ts`,
          location: { start: { line: 20 + i, column: 5 }, end: { line: 20 + i, column: 9 } },
        })),
      ],
      edges: [
        ...Array.from({ length: 10 }, (_, i) => ({
          from: `ref:func:${20 + i}:5`,
          to: 'def:func:10:1',
          type: 'call' as const,
          confidence: 'high' as const,
        })),
      ],
    };

    const res = await resolver.resolve({
      req: {
        instruction: 'fix `func`',
        repoPath: '/repo',
        primaryFile: 'src/func.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      symbolMap,
      maxDiffusionTargets: 5,
    });

    // Should provide metrics about budget usage
    expect(res.diffusionMetrics).toBeDefined();
    expect(res.diffusionMetrics?.totalCandidates).toBe(10);
    expect(res.diffusionMetrics?.selectedTargets).toBeLessThanOrEqual(5);
    expect(res.diffusionMetrics?.budgetLimit).toBe(5);
  });
});
