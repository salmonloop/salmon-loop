import { describe, expect, it } from 'bun:test';

import { TargetResolver } from '../../../src/core/context/targeting/target-resolver.js';

describe('TargetResolver (symbol targets)', () => {
  it('selects symbol_definition targets when instruction references a known definition', async () => {
    const resolver = new TargetResolver();
    const res = await resolver.resolve({
      req: {
        instruction: 'Fix `packUntilFull` behavior',
        repoPath: '/repo',
        primaryFile: 'src/core/context/policies/pack-until-full.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      definitionMap: {
        packUntilFull: {
          start: { line: 10, column: 1 },
          end: { line: 10, column: 10 },
        },
      },
    });

    expect(res.strategy).toBe('symbol');
    expect(res.targets[0]?.path).toBe('src/core/context/policies/pack-until-full.ts');
    expect(res.targets[0]?.reason).toBe('symbol_definition');
  });

  it('keeps explicit_path higher priority than symbol_definition', async () => {
    const resolver = new TargetResolver();
    const res = await resolver.resolve({
      req: {
        instruction: 'Update src/other.ts and fix `packUntilFull`',
        repoPath: '/repo',
        primaryFile: 'src/core/context/policies/pack-until-full.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      definitionMap: {
        packUntilFull: {
          start: { line: 10, column: 1 },
          end: { line: 10, column: 10 },
        },
      },
    });

    expect(res.strategy).toBe('explicit');
    expect(res.targets.some((t) => t.reason === 'explicit_path')).toBe(true);
  });

  it('resolves symbol targets from symbolMap even without definitionMap', async () => {
    const resolver = new TargetResolver();
    const res = await resolver.resolve({
      req: {
        instruction: 'fix `packUntilFull` callsites',
        repoPath: '/repo',
        primaryFile: 'src/core/context/policies/pack-until-full.ts',
      },
      includedFiles: [],
      importRelatedFiles: [],
      rgHitFiles: [],
      definitionMap: undefined,
      symbolMap: {
        nodes: [
          {
            id: 'def:packUntilFull:10:1',
            name: 'packUntilFull',
            kind: 'definition',
            path: 'src/core/context/policies/pack-until-full.ts',
            location: { start: { line: 10, column: 1 }, end: { line: 10, column: 12 } },
          },
          {
            id: 'ref:packUntilFull:30:5',
            name: 'packUntilFull',
            kind: 'reference',
            path: 'src/core/context/steps/context-budget.ts',
            location: { start: { line: 30, column: 5 }, end: { line: 30, column: 18 } },
          },
        ],
        edges: [
          {
            from: 'ref:packUntilFull:30:5',
            to: 'def:packUntilFull:10:1',
            type: 'call',
            confidence: 'high',
          },
        ],
      },
    });

    expect(res.strategy).toBe('symbol');
    expect(res.targets.some((t) => t.path === 'src/core/context/steps/context-budget.ts')).toBe(
      true,
    );
  });

  it('applies churn weight and orders targets by churn in default strategy', async () => {
    const resolver = new TargetResolver();
    const res = await resolver.resolve({
      req: {
        instruction: 'please improve context ranking',
        repoPath: '/repo',
        primaryFile: 'src/core/context/service.ts',
      },
      includedFiles: [],
      importRelatedFiles: ['src/a.ts', 'src/b.ts'],
      rgHitFiles: [],
      churnByFile: {
        'src/a.ts': 2,
        'src/b.ts': 9,
      },
    });

    expect(res.strategy).toBe('default');
    expect(res.targets[0]?.path).toBe('src/core/context/service.ts');
    expect(res.targets[1]?.path).toBe('src/b.ts');
    expect(res.targets[1]?.churnWeight).toBeGreaterThan(res.targets[2]?.churnWeight ?? 0);
  });
});
