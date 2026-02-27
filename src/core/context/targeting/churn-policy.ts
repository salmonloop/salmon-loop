export interface ChurnRankingPolicy {
  primaryBoost: number;
  rerankWeight: number;
  tieBreakWeight: number;
}

export const DEFAULT_CHURN_RANKING_POLICY: ChurnRankingPolicy = {
  primaryBoost: 10000,
  rerankWeight: 0.35,
  tieBreakWeight: 0.05,
};

let globalChurnRankingPolicy: ChurnRankingPolicy = { ...DEFAULT_CHURN_RANKING_POLICY };

export function getChurnRankingPolicy(): ChurnRankingPolicy {
  return { ...globalChurnRankingPolicy };
}

export function setChurnRankingPolicy(policy?: Partial<ChurnRankingPolicy>): void {
  if (!policy) {
    globalChurnRankingPolicy = { ...DEFAULT_CHURN_RANKING_POLICY };
    return;
  }
  globalChurnRankingPolicy = {
    primaryBoost:
      typeof policy.primaryBoost === 'number'
        ? policy.primaryBoost
        : DEFAULT_CHURN_RANKING_POLICY.primaryBoost,
    rerankWeight:
      typeof policy.rerankWeight === 'number'
        ? policy.rerankWeight
        : DEFAULT_CHURN_RANKING_POLICY.rerankWeight,
    tieBreakWeight:
      typeof policy.tieBreakWeight === 'number'
        ? policy.tieBreakWeight
        : DEFAULT_CHURN_RANKING_POLICY.tieBreakWeight,
  };
}
