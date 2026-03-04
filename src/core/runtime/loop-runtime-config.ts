import { resolveConfig } from '../config/resolve.js';
import type { ResolvedConfig } from '../config/types.js';
import { getGlobalAdjuster, resetGlobalAdjuster } from '../context/budget/dynamic-adjuster.js';
import {
  initializeDefaultCalculator,
  setDefaultModel,
  setUseTokenBudget,
} from '../context/policies/pack-until-full.js';
import { setAuditBufferLimits } from '../observability/audit-trail.js';
import { setRedactionConfig } from '../security/redaction.js';
import type { LoopOptions } from '../types/runtime.js';

export async function resolveAndApplyRuntimeConfig(options: LoopOptions): Promise<ResolvedConfig> {
  const config = await resolveConfig({
    repoRoot: options.repoPath,
  });
  setUseTokenBudget(config.context.useTokenBudget);
  setAuditBufferLimits(config.observability.audit.buffer);
  setRedactionConfig(config.security.redaction);

  const modelId = config.llm.models.selectedModelId;
  if (modelId) {
    setDefaultModel(modelId);
  }

  await initializeDefaultCalculator().catch(() => {
    // Fall back to char-based budget if tokenizer bootstrap fails.
  });

  resetGlobalAdjuster();
  if (config.context.dynamicBudget.enabled) {
    getGlobalAdjuster(config.context.dynamicBudget);
  }

  return config;
}
