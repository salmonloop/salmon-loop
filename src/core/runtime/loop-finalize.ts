import { text } from '../../locales/index.js';
import type { ResolvedConfig } from '../config/types.js';
import { HostRunner } from '../grizzco/runtime/host/host-runner.js';
import { appendAuditTrailToAuditFile } from '../observability/audit-file.js';
import {
  clearAuditContext,
  drainAuditDropStats,
  recordAuditEvent,
} from '../observability/audit-trail.js';
import { logger } from '../observability/logger.js';
import { buildRunOutcomeReport } from '../observability/run-outcome-reporter.js';
import { drainRedactionMetrics } from '../security/redaction.js';
import type { LoopOptions, LoopResult } from '../types/index.js';

export async function finalizeLoopRun(params: {
  config: ResolvedConfig;
  options: LoopOptions;
  hostRunner: HostRunner;
  correlationId: string;
  latestAuditPath?: string;
  finalResult?: LoopResult;
}): Promise<{ latestAuditPath?: string; finalResult?: LoopResult }> {
  let { latestAuditPath } = params;
  const { finalResult } = params;
  const { config, options, hostRunner, correlationId } = params;

  try {
    await hostRunner.teardown();
  } finally {
    if (options.outcomeReporter && finalResult) {
      try {
        await options.outcomeReporter.report(buildRunOutcomeReport(finalResult), {
          runId: correlationId,
          auditPath: latestAuditPath,
          mode: options.mode,
          repoPath: options.repoPath,
          sessionId: options.langfuseSessionId,
          userId: options.langfuseUserId,
          instruction: options.instruction,
          verify: options.verify,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(text.grizzco.observability.outcomeReporterFailed(msg));
      }
    }
    const redactionStats = drainRedactionMetrics();
    if (redactionStats.count > 0) {
      recordAuditEvent(
        'context.redaction.count',
        { count: redactionStats.count },
        { source: 'security', severity: 'low', scope: 'session' },
      );
    }
    const dropStats = drainAuditDropStats();
    if (dropStats.count > 0) {
      recordAuditEvent(
        'audit.dropped',
        { count: dropStats.count, since: dropStats.since },
        { source: 'audit', severity: 'medium', scope: 'session' },
      );
      const warnThreshold = config.observability.audit.buffer.droppedWarn;
      if (dropStats.count >= warnThreshold) {
        logger.warn(`Audit buffer dropped ${dropStats.count} events (threshold=${warnThreshold}).`);
        recordAuditEvent(
          'audit.dropped.warn',
          { count: dropStats.count, since: dropStats.since, threshold: warnThreshold },
          { source: 'audit', severity: 'high', scope: 'session' },
        );
      }
    }

    const fallbackFailureReason =
      finalResult && !finalResult.success ? finalResult.reason : undefined;
    const appendedPath = await appendAuditTrailToAuditFile({
      auditPath: latestAuditPath,
      repoPath: options.repoPath,
      auditScope: options.auditScope,
      failureReason: fallbackFailureReason,
      runId: correlationId,
      finalOutcome: finalResult
        ? {
            success: finalResult.success,
            reasonCode: finalResult.reasonCode,
            failurePhase: finalResult.failurePhase,
            errorCode: finalResult.errorCode,
          }
        : undefined,
    });
    if (!latestAuditPath && appendedPath) {
      latestAuditPath = appendedPath;
      if (finalResult) finalResult.auditPath = appendedPath;
    }
    clearAuditContext();
  }

  return { latestAuditPath, finalResult };
}
