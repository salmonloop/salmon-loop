import { text } from '../../../locales/index.js';
import { Pipeline } from '../../grizzco/pipeline.js';
import { saveAudit } from '../../grizzco/steps/audit.js';
import { buildContext } from '../../grizzco/steps/context.js';
import { generatePatch } from '../../grizzco/steps/patch.js';
import { generatePlan } from '../../grizzco/steps/plan.js';
import { runPreflight } from '../../grizzco/steps/preflight.js';
import { InitCtx } from '../../grizzco/types.js';
import { logger } from '../../logger.js';
import { IExecutable, SubAgentProfile, SubAgentResult } from '../types.js';

/**
 * SmallfryLoop (The "Little Fry" in the loop)
 * A specialized execution flow for sub-agents.
 *
 * This loop is intentionally proposal-only:
 * - It may generate plans and patches.
 * - It MUST NOT mutate the user's workspace (no APPLY, no VERIFY).
 *
 * Mutation remains the responsibility of the primary salmonloop (s8p) runtime.
 */
export class SmallfryLoop implements IExecutable<InitCtx, SubAgentResult> {
  constructor(private profile: SubAgentProfile) {}

  /**
   * Run the recursive loop based on the stratagem.
   */
  async execute(initCtx: InitCtx): Promise<SubAgentResult> {
    logger.info(`[SmallfryLoop] ${text.smallfry.status.working} (${this.profile.name})`);

    let pipeline: Pipeline<any> = Pipeline.of(initCtx);

    // Dynamic Phase Injection based on Stratagem
    pipeline = pipeline.step('PREFLIGHT', runPreflight);
    pipeline = pipeline.step('CONTEXT', buildContext);
    pipeline = pipeline.step('PLAN', generatePlan);

    if (this.profile.stratagem === 'surgeon') {
      pipeline = pipeline.step('PATCH', generatePatch);
    }

    const report = await pipeline.execute();
    report.auditPath = await saveAudit(report, initCtx.options);
    const finalCtx = report.data;

    // 4. Audit & Resource Tracking (Physical Traceability)
    // We sum up actual token usage from traces if available, otherwise fallback to estimation
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const trace of report.traces) {
      if (trace.metadata?.usage) {
        totalInputTokens += trace.metadata.usage.prompt_tokens || 0;
        totalOutputTokens += trace.metadata.usage.completion_tokens || 0;
      }
    }

    const tokenUsage = totalInputTokens + totalOutputTokens;

    // Hard Budget Enforcement Check
    if (this.profile.maxTokens && tokenUsage > this.profile.maxTokens) {
      logger.warn(`[SmallfryLoop] Budget exceeded: ${tokenUsage}/${this.profile.maxTokens}`);
      report.success = false;
      finalCtx.reason = text.smallfry.errors.budgetExceeded(tokenUsage, this.profile.maxTokens);
    }

    return {
      agent_ref: this.profile.id,
      success: report.success,
      summary: report.success
        ? text.smallfry.status.submitting
        : finalCtx?.reason || report.error?.message || text.smallfry.errors.missionFailed,
      tokenUsage,
      auditPath: report.auditPath,
      reason: finalCtx?.reason || report.error?.message || '',
      reasonCode: finalCtx?.reasonCode || (report.success ? 'SUCCESS' : 'LOOP_FAILED'),
      attempts: finalCtx?.attempt || 1,
      logs: finalCtx?.logs || [],
      failurePhase: report.lastStep as any,
      errorType: finalCtx?.errorType,
      finalPatch: typeof finalCtx?.diff === 'string' ? finalCtx.diff : undefined,
      changedFiles: Array.isArray(finalCtx?.changedFiles) ? finalCtx.changedFiles : [],
    };
  }
}
