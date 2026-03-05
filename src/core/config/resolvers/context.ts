import { DEFAULT_DYNAMIC_BUDGET, DEFAULT_USE_TOKEN_BUDGET } from '../defaults.js';
import type { ConfigFileV1, ResolvedConfig } from '../types.js';

export function resolveUseTokenBudget(raw?: ConfigFileV1): boolean {
  const value = raw?.context?.useTokenBudget;
  if (value === undefined) return DEFAULT_USE_TOKEN_BUDGET;
  return value !== false;
}

export function resolveDynamicBudget(
  raw?: ConfigFileV1,
): ResolvedConfig['context']['dynamicBudget'] {
  const config = raw?.context?.dynamicBudget;
  return {
    enabled: config?.enabled ?? DEFAULT_DYNAMIC_BUDGET.enabled,
    minBudget: config?.minBudget ?? DEFAULT_DYNAMIC_BUDGET.minBudget,
    maxBudget: config?.maxBudget ?? DEFAULT_DYNAMIC_BUDGET.maxBudget,
    adjustmentStep: config?.adjustmentStep ?? DEFAULT_DYNAMIC_BUDGET.adjustmentStep,
    alerts: {
      truncationRateWarn:
        config?.alerts?.truncationRateWarn ?? DEFAULT_DYNAMIC_BUDGET.alerts.truncationRateWarn,
      criticalDropRateWarn:
        config?.alerts?.criticalDropRateWarn ?? DEFAULT_DYNAMIC_BUDGET.alerts.criticalDropRateWarn,
    },
  };
}
