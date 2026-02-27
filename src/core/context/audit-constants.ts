export const CONTEXT_AUDIT_ACTION = {
  inputSummary: 'context.input.summary',
  cacheLookup: 'context.cache.lookup',
  keywordsExtracted: 'context.keywords.extracted',
  gatherCompleted: 'context.gather.completed',
  targetingCandidates: 'context.targeting.candidates',
  targetsResolved: 'context.targets.resolved',
  budgetPolicyPlan: 'context.budget.policy.plan',
  relevanceRanking: 'context.relevance.ranking',
  packSummary: 'context.pack.summary',
  shrinkSummary: 'context.shrink.summary',
  promotionCompleted: 'context.promotion.completed',
} as const;

export const CONTEXT_AUDIT_PHASE = {
  primary: 'CONTEXT_PRIMARY',
  gather: 'CONTEXT_GATHER',
  targets: 'CONTEXT_TARGETS',
  promotion: 'CONTEXT_PROMOTION',
  budget: 'CONTEXT_BUDGET',
  shrink: 'SHRINK',
} as const;
