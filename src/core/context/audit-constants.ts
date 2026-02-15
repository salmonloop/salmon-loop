export const CONTEXT_AUDIT_ACTION = {
  keywordsExtracted: 'context.keywords.extracted',
  gatherCompleted: 'context.gather.completed',
  targetingCandidates: 'context.targeting.candidates',
  targetsResolved: 'context.targets.resolved',
  budgetPolicyPlan: 'context.budget.policy.plan',
  relevanceRanking: 'context.relevance.ranking',
  packSummary: 'context.pack.summary',
  shrinkSummary: 'context.shrink.summary',
} as const;

export const CONTEXT_AUDIT_PHASE = {
  gather: 'CONTEXT_GATHER',
  targets: 'CONTEXT_TARGETS',
  budget: 'CONTEXT_BUDGET',
  shrink: 'SHRINK',
} as const;
