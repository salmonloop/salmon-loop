import * as fs from 'fs/promises';

import { getAuditTrail } from '../../audit-trail.js';
import { logger } from '../../logger.js';
import { getAuditDir } from '../../runtime-paths.js';
import { SalmonError } from '../../types.js';
import { FlowReport } from '../pipeline.js';

export async function saveAudit(report: FlowReport, _options: any): Promise<string | undefined> {
  try {
    const auditDir = getAuditDir(_options?.repoPath || process.cwd());
    await fs.mkdir(auditDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-${timestamp}.json`;

    // Sanitize context data to be JSON friendly
    const ctx = report.data as any;
    const sanitizedData = sanitizeContext(report.data);

    const errorMeta =
      report.error && report.error instanceof Error
        ? {
            name: report.error.name,
            message: report.error.message,
            stack: report.error.stack,
            code:
              report.error instanceof SalmonError
                ? report.error.code
                : (report.error as any)?.code || (report.error as any)?.llmCode,
          }
        : report.error
          ? { name: 'UnknownError', message: String(report.error), stack: undefined }
          : undefined;

    const toolAuditLogs = ctx?.toolAuditLogger?.getLogs?.() || [];
    const authorizationIndex = toolAuditLogs
      .filter((entry: any) => entry.eventType === 'authorization')
      .reduce((acc: Record<string, any>, entry: any) => {
        acc[entry.callId] = {
          outcome: entry.authOutcome,
          reason: entry.authReason,
          source: entry.authSource,
          riskLevel: entry.authRiskLevel,
          sideEffects: entry.authSideEffects,
          ttlMs: entry.authTtlMs,
        };
        return acc;
      }, {});

    const auditData = {
      meta: {
        timestamp: new Date().toISOString(),
        duration: report.duration,
        success: report.success,
        lastStep: report.lastStep,
        // Keep a stable, human-friendly message for backwards compatibility.
        error: errorMeta?.message,
        errorName: errorMeta?.name,
        errorCode: (errorMeta as any)?.code,
        errorStack: errorMeta?.stack,
      },
      traces: report.traces,
      context: {
        ...sanitizedData,
        auditTrail: getAuditTrail(),
      },
      authorizationIndex,
      environment: {
        cwd: process.cwd(),
        nodeVersion: process.version,
      },
    };

    await fs.writeFile(`${auditDir}/${filename}`, JSON.stringify(auditData, null, 2));

    logger.debug(`[Audit] Saved structured audit log to ${filename}`);
    return `${auditDir}/${filename}`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[Audit] Failed to save audit log: ${msg}`);
    return undefined;
  }
}

function sanitizeContext(ctx: any): any {
  if (!ctx) return null;

  const safe: any = {};

  // Extract key fields that are serializable
  if (ctx.preflightResult) safe.preflightResult = ctx.preflightResult;
  if (ctx.plan) safe.plan = ctx.plan; // plan object usually serializable
  if (ctx.diffMeta) safe.diffMeta = ctx.diffMeta;
  if (ctx.isValid !== undefined) safe.isValid = ctx.isValid;
  if (ctx.astValid !== undefined) safe.astValid = ctx.astValid;
  if (ctx.astError) safe.astError = ctx.astError;

  if (ctx.applyResult) {
    safe.applyResult = {
      success: ctx.applyResult.success,
      successCount: ctx.applyResult.successCount,
      totalFiles: ctx.applyResult.totalFiles,
      // decisions are already JSON objects
      decisions: ctx.applyResult.decisions,
      // results might contain errors
      results: ctx.applyResult.results?.map((r: any) => ({
        success: r.success,
        actionTaken: r.actionTaken,
        error: r.error,
      })),
    };
  }

  if (ctx.verifyResult) safe.verifyResult = ctx.verifyResult;

  if ((ctx as any).toolCallingAudit && Array.isArray((ctx as any).toolCallingAudit)) {
    safe.toolCallingAudit = (ctx as any).toolCallingAudit;
  }

  if ((ctx as any).toolAuditLogger?.getLogs) {
    safe.toolAuditLogs = (ctx as any).toolAuditLogger.getLogs();
  }

  return safe;
}
