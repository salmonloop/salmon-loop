import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_CHURN_RANKING_POLICY,
  setChurnRankingPolicy,
} from '../../../src/core/context/targeting/churn-policy.js';
import { TargetResolver } from '../../../src/core/context/targeting/target-resolver.js';

describe('churn ranking policy', () => {
  it('uses global policy defaults in target ranking when resolver options are omitted', async () => {
    try {
      setChurnRankingPolicy({
        primaryBoost: 10000,
        rerankWeight: 0,
        tieBreakWeight: 0,
      });
      const resolver = new TargetResolver();
      const res = await resolver.resolve({
        req: {
          instruction: 'improve context',
          repoPath: '/repo',
          primaryFile: 'src/core/context/service.ts',
        },
        includedFiles: [],
        importRelatedFiles: ['src/z.ts', 'src/a.ts'],
        rgHitFiles: [],
        churnByFile: {
          'src/z.ts': 99,
          'src/a.ts': 1,
        },
      });

      expect(res.targets[1]?.path).toBe('src/a.ts');
      expect(res.targets[2]?.path).toBe('src/z.ts');
    } finally {
      setChurnRankingPolicy(DEFAULT_CHURN_RANKING_POLICY);
    }
  });
});
