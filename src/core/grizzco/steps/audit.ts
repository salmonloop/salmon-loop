import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';

import { getAuditTrail } from '../../observability/audit-trail.js';
import { logger } from '../../observability/logger.js';
import { getAuditDir } from '../../runtime/paths.js';
import { SalmonError, type LoopOptions } from '../../types/index.js';
import { FlowReport } from '../engine/pipeline/pipeline.js';
import type { ShrinkCtx } from '../engine/pipeline/types.js';

type AuditContext = Partial<ShrinkCtx>;

const VERIFY_OUTPUT = {
  maxInlineChars: 4000,
  previewHeadChars: 2000,
  previewTailChars: 2000,
} as const;

export async function saveAudit(
  report: FlowReport,
  _options: LoopOptions,
): Promise<string | undefined> {
  try {
    const auditDir = getAuditDir(_options?.repoPath || process.cwd());
    await fs.mkdir(auditDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `audit-${timestamp}.json`;

    // Sanitize context data to be JSON friendly
    const ctx = report.data as AuditContext | undefined;
    const sanitizedData = sanitizeContext(report.data);
    await externalizeVerifyOutput({
      auditDir,
      timestamp,
      sanitizedContext: sanitizedData,
    });

    const errorInfo = report.error as (Error & { code?: string; llmCode?: string }) | undefined;
    const errorMeta =
      report.error && report.error instanceof Error
        ? {
            name: report.error.name,
            message: report.error.message,
            stack: report.error.stack,
            code:
              report.error instanceof SalmonError
                ? report.error.code
                : errorInfo?.code || errorInfo?.llmCode,
          }
        : report.error
          ? { name: 'UnknownError', message: String(report.error), stack: undefined }
          : undefined;

    const toolAuditLogs = ctx?.toolAuditLogger?.getLogs?.() || [];
    const authorizationIndex = toolAuditLogs
      .filter((entry) => entry.eventType === 'authorization')
      .reduce((acc: Record<string, unknown>, entry) => {
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

function buildVerifyOutputPreview(output: string): string {
  if (output.length <= VERIFY_OUTPUT.maxInlineChars) return output;
  const head = output.slice(0, VERIFY_OUTPUT.previewHeadChars);
  const tail = output.slice(Math.max(0, output.length - VERIFY_OUTPUT.previewTailChars));
  return `${head}\n\n[...truncated...]\n\n${tail}`;
}

async function externalizeVerifyOutput(args: {
  auditDir: string;
  timestamp: string;
  sanitizedContext: Record<string, unknown> | null;
}): Promise<void> {
  const { auditDir, timestamp, sanitizedContext } = args;
  if (!sanitizedContext) return;

  const verifyResult = sanitizedContext.verifyResult as any;
  if (!verifyResult || typeof verifyResult !== 'object') return;

  const output = verifyResult.output;
  if (typeof output !== 'string') return;
  if (output.length <= VERIFY_OUTPUT.maxInlineChars) return;

  const blobDir = path.join(auditDir, 'blobs');
  await fs.mkdir(blobDir, { recursive: true });

  const sha256 = createHash('sha256').update(output, 'utf8').digest('hex');
  const blobName = `verify-output-${timestamp}-${sha256.slice(0, 8)}.log`;
  const blobPath = path.join(blobDir, blobName);
  await fs.writeFile(blobPath, output, 'utf8');

  verifyResult.output = buildVerifyOutputPreview(output);
  verifyResult.outputTruncated = true;
  verifyResult.outputBlob = {
    path: path.join('blobs', blobName),
    sha256,
    chars: output.length,
  };
}

function sanitizeContext(ctx: unknown): Record<string, unknown> | null {
  if (!ctx || typeof ctx !== 'object') return null;

  const safe: Record<string, unknown> = {};
  const typed = ctx as AuditContext;

  // Extract key fields that are serializable
  if (typed.preflightResult) safe.preflightResult = typed.preflightResult;
  if (typed.plan) safe.plan = typed.plan; // plan object usually serializable
  if (typed.planRuntime) safe.planRuntime = typed.planRuntime;
  if (typed.diffMeta) safe.diffMeta = typed.diffMeta;
  if (typed.isValid !== undefined) safe.isValid = typed.isValid;
  if (typed.astValid !== undefined) safe.astValid = typed.astValid;
  if (typed.astError) safe.astError = typed.astError;

  if (typed.applyResult) {
    safe.applyResult = {
      success: typed.applyResult.success,
      successCount: typed.applyResult.successCount,
      totalFiles: typed.applyResult.totalFiles,
      // decisions are already JSON objects
      decisions: typed.applyResult.decisions,
      // results might contain errors
      results: typed.applyResult.results?.map((r) => ({
        success: r.success,
        actionTaken: r.actionTaken,
        error: r.error,
      })),
    };
  }

  if (typed.verifyResult) safe.verifyResult = typed.verifyResult;
  if (typed.verifyArtifact) safe.verifyArtifact = typed.verifyArtifact;
  if (typed.rolledBack !== undefined) safe.rolledBack = typed.rolledBack;
  if (typed.shrunk !== undefined) safe.shrunk = typed.shrunk;
  if (typed.applyBackResult) safe.applyBackResult = typed.applyBackResult;

  if (typed.toolCallingAudit && Array.isArray(typed.toolCallingAudit)) {
    safe.toolCallingAudit = typed.toolCallingAudit;
  }

  if (typed.toolAuditLogger?.getLogs) {
    safe.toolAuditLogs = typed.toolAuditLogger.getLogs();
  }

  return safe;
}
