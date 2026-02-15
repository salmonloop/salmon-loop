import { describe, expect, it } from 'vitest';

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
});
