import { describe, expect, it } from 'vitest';

import { TargetResolver } from '../../../src/core/context/targeting/target-resolver.js';
import type { SymbolMap } from '../../../src/core/types/index.js';

describe('Symbol diffusion with distance and weight control', () => {
  it('limits symbol diffusion to distance 1 by default', async () => {
    const resolver = new TargetResolver();

    // Symbol graph:
    // caller1 -> helper -> utility
    // Distance: caller1 is distance 1 from helper
    //           utility is distance 2 from helper (should NOT be included by default)

    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:helper:10:1',
          name: 'helper',
          kind: 'definition',
          path: 'src/helper.ts',
          location: { start: { line: 10, column: 1 }, end: { line: 10, column: 7 } },
        },
        {
          id: 'ref:helper:20:5',
          name: 'helper',
          kind: 'reference',
          path: 'src/caller1.ts',
          location: { start: { line: 20, column: 5 }, end: { line: 20, column: 12 } },
        },
        {
          id: 'def:utility:5:1',
          name: 'utility',
          kind: 'definition',
          path: 'src/utility.ts',
          location: { start: { line: 5, column: 1 }, end: { line: 5, column: 8 } },
        },
        {
          id: 'ref:utility:12:3',
          name: 'utility',
          kind: 'reference',
          path: 'src/helper.ts',
          location: { start: { line: 12, column: 3 }, end: { line: 12, column: 11 } },
        },
      ],
      edges: [
        {
          from: 'ref:helper:20:5',
          to: 'def:helper:10:1',
          type: 'call',
          confidence: 'high',
        },
        {
          from: 'ref:utility:12:3',
          to: 'def:utility:5:1',
          type: 'call',
          confidence: 'medium',
        },
      ],
    };

    const res = await resolver.resolve({
      req: {
        instruction: 'fix `helper` function',
        repoPath: '/repo',
        primaryFile: 'src/helper.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      symbolMap,
    });

    // Should include helper definition and its direct callers (distance 1)
    expect(res.targets.some((t) => t.path === 'src/helper.ts')).toBe(true);
    expect(res.targets.some((t) => t.path === 'src/caller1.ts')).toBe(true);

    // Should NOT include utility (distance 2 from helper)
    expect(res.targets.some((t) => t.path === 'src/utility.ts')).toBe(false);
  });

  it('expands to distance 2 when explicitly requested', async () => {
    const resolver = new TargetResolver();

    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:helper:10:1',
          name: 'helper',
          kind: 'definition',
          path: 'src/helper.ts',
          location: { start: { line: 10, column: 1 }, end: { line: 10, column: 7 } },
        },
        {
          id: 'ref:utility:12:3',
          name: 'utility',
          kind: 'reference',
          path: 'src/helper.ts',
          location: { start: { line: 12, column: 3 }, end: { line: 12, column: 11 } },
        },
        {
          id: 'def:utility:5:1',
          name: 'utility',
          kind: 'definition',
          path: 'src/utility.ts',
          location: { start: { line: 5, column: 1 }, end: { line: 5, column: 8 } },
        },
      ],
      edges: [
        {
          from: 'ref:utility:12:3',
          to: 'def:utility:5:1',
          type: 'call',
          confidence: 'medium',
        },
      ],
    };

    // Need to add diffusionDepth parameter to resolve method
    const res = await resolver.resolve({
      req: {
        instruction: 'refactor `helper` and all its dependencies',
        repoPath: '/repo',
        primaryFile: 'src/helper.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      symbolMap,
      diffusionDepth: 2, // NEW PARAMETER
    });

    // Should include utility at distance 2
    expect(res.targets.some((t) => t.path === 'src/utility.ts')).toBe(true);
  });

  it('prioritizes high-confidence edges over low-confidence edges', async () => {
    const resolver = new TargetResolver();

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
          path: 'src/caller-high.ts',
          location: { start: { line: 20, column: 5 }, end: { line: 20, column: 12 } },
        },
        {
          id: 'ref:target:30:10',
          name: 'target',
          kind: 'reference',
          path: 'src/caller-low.ts',
          location: { start: { line: 30, column: 10 }, end: { line: 30, column: 17 } },
        },
      ],
      edges: [
        {
          from: 'ref:target:20:5',
          to: 'def:target:10:1',
          type: 'call',
          confidence: 'high',
        },
        {
          from: 'ref:target:30:10',
          to: 'def:target:10:1',
          type: 'reference',
          confidence: 'low',
        },
      ],
    };

    const res = await resolver.resolve({
      req: {
        instruction: 'fix `target`',
        repoPath: '/repo',
        primaryFile: 'src/target.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      symbolMap,
      maxDiffusionTargets: 1, // Only include top 1 target
    });

    // Should prioritize high-confidence caller
    expect(res.targets.some((t) => t.path === 'src/caller-high.ts')).toBe(true);
    expect(res.targets.some((t) => t.path === 'src/caller-low.ts')).toBe(false);
  });

  it('uses edge weight to control diffusion order', async () => {
    // Edge weight should be calculated from:
    // - Edge type (call > reference)
    // - Confidence level (high > medium > low)
    // - Distance from primary symbol

    const resolver = new TargetResolver();

    const symbolMap: SymbolMap = {
      nodes: [
        {
          id: 'def:core:10:1',
          name: 'core',
          kind: 'definition',
          path: 'src/core.ts',
          location: { start: { line: 10, column: 1 }, end: { line: 10, column: 5 } },
        },
        {
          id: 'ref:core:20:5',
          name: 'core',
          kind: 'reference',
          path: 'src/call-site.ts',
          location: { start: { line: 20, column: 5 }, end: { line: 20, column: 9 } },
        },
        {
          id: 'ref:core:30:10',
          name: 'core',
          kind: 'reference',
          path: 'src/ref-site.ts',
          location: { start: { line: 30, column: 10 }, end: { line: 30, column: 14 } },
        },
      ],
      edges: [
        {
          from: 'ref:core:20:5',
          to: 'def:core:10:1',
          type: 'call',
          confidence: 'high',
          // Weight should be: call(3) + high(3) = 6
        },
        {
          from: 'ref:core:30:10',
          to: 'def:core:10:1',
          type: 'reference',
          confidence: 'medium',
          // Weight should be: reference(1) + medium(2) = 3
        },
      ],
    };

    const res = await resolver.resolve({
      req: {
        instruction: 'update `core`',
        repoPath: '/repo',
        primaryFile: 'src/core.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      symbolMap,
      maxDiffusionTargets: 1,
    });

    // Should prioritize call-site (weight 6) over ref-site (weight 3)
    const callerTarget = res.targets.find((t) => t.path === 'src/call-site.ts');
    const refTarget = res.targets.find((t) => t.path === 'src/ref-site.ts');

    expect(callerTarget).toBeDefined();
    expect(refTarget).toBeUndefined();
  });
});
