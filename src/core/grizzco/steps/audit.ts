import * as fs from 'fs/promises';
import * as path from 'path';

import { logger } from '../../logger.js';
import { FlowReport } from '../pipeline.js';

export async function saveAudit(report: FlowReport, _options: any): Promise<void> {
  try {
    const auditDir = path.join(process.cwd(), '.s8p/audit');
    await fs.mkdir(auditDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-${timestamp}.json`;

    // Sanitize context data to be JSON friendly
    const sanitizedData = sanitizeContext(report.data);

    const errorMeta =
      report.error && report.error instanceof Error
        ? {
            name: report.error.name,
            message: report.error.message,
            stack: report.error.stack,
          }
        : report.error
          ? { name: 'UnknownError', message: String(report.error), stack: undefined }
          : undefined;

    const auditData = {
      meta: {
        timestamp: new Date().toISOString(),
        duration: report.duration,
        success: report.success,
        lastStep: report.lastStep,
        // Keep a stable, human-friendly message for backwards compatibility.
        error: errorMeta?.message,
        errorName: errorMeta?.name,
        errorStack: errorMeta?.stack,
      },
      traces: report.traces,
      context: sanitizedData,
      environment: {
        cwd: process.cwd(),
        nodeVersion: process.version,
      },
    };

    await fs.writeFile(path.join(auditDir, filename), JSON.stringify(auditData, null, 2));

    logger.debug(`[Audit] Saved structured audit log to ${filename}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[Audit] Failed to save audit log: ${msg}`);
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

  return safe;
}
