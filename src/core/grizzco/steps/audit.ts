import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import path from 'path';

import { LIMITS } from '../../config/limits.js';
import { truncateOutput } from '../../context/truncation/index.js';
import { getAuditTrail, recordAuditEvent } from '../../observability/audit-trail.js';
import { logger } from '../../observability/logger.js';
import { getAuditDir } from '../../runtime/paths.js';
import { SalmonError, type LoopOptions } from '../../types/index.js';
import { FlowReport } from '../engine/pipeline/pipeline.js';
import type { ShrinkCtx } from '../engine/pipeline/types.js';

type AuditContext = Partial<ShrinkCtx>;

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
    try {
      await externalizeVerifyOutput({
        auditDir,
        timestamp,
        sanitizedContext: sanitizedData,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[Audit] Failed to externalize verify output: ${msg}`);
      recordAuditEvent(
        'audit.blob.externalize.failed',
        { target: 'verifyResult.output', error: msg.slice(0, 500) },
        { source: 'saveAudit', severity: 'low', scope: 'session', phase: 'AUDIT' },
      );
    }
    try {
      await externalizeToolAuditTextFields({
        auditDir,
        timestamp,
        sanitizedContext: sanitizedData,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[Audit] Failed to externalize tool audit summaries: ${msg}`);
      recordAuditEvent(
        'audit.blob.externalize.failed',
        { target: 'toolAuditLogs.*', error: msg.slice(0, 500) },
        { source: 'saveAudit', severity: 'low', scope: 'session', phase: 'AUDIT' },
      );
    }

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

function buildVerifyOutputPreview(output: string, typeHint?: string): string {
  if (output.length <= LIMITS.auditVerifyOutputMaxInlineChars) return output;

  // Use semantic truncation for better output preservation
  const result = truncateOutput(output, LIMITS.auditVerifyOutputMaxInlineChars, typeHint);

  return result.content;
}

function buildToolSummaryPreview(output: string, typeHint?: string): string {
  if (output.length <= LIMITS.auditToolSummaryMaxInlineChars) return output;

  // Use semantic truncation for better output preservation
  const result = truncateOutput(output, LIMITS.auditToolSummaryMaxInlineChars, typeHint);

  return result.content;
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function writeBlobBestEffort(args: {
  blobDir: string;
  blobName: string;
  content: string;
  auditTarget: string;
}): Promise<
  | {
      path: string;
      sha256: string;
      chars: number;
    }
  | undefined
> {
  const { blobDir, blobName, content, auditTarget } = args;
  const sha256 = sha256Hex(content);
  const blobPath = path.join(blobDir, blobName);

  try {
    await fs.mkdir(blobDir, { recursive: true });
    await fs.writeFile(blobPath, content, 'utf8');
    return { path: path.join('blobs', blobName), sha256, chars: content.length };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(`[Audit] Failed to write blob ${blobName}: ${msg}`);
    recordAuditEvent(
      'audit.blob.write.failed',
      {
        target: auditTarget,
        blobName,
        sha256,
        chars: content.length,
        error: msg.slice(0, 500),
      },
      { source: 'saveAudit', severity: 'low', scope: 'session', phase: 'AUDIT' },
    );
    return undefined;
  }
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
  if (output.length <= LIMITS.auditVerifyOutputMaxInlineChars) return;

  const blobDir = path.join(auditDir, 'blobs');

  verifyResult.output = buildVerifyOutputPreview(output);
  verifyResult.outputTruncated = true;

  const sha256 = sha256Hex(output);
  const blobName = `verify-output-${timestamp}-${sha256.slice(0, 8)}.log`;
  const blob = await writeBlobBestEffort({
    blobDir,
    blobName,
    content: output,
    auditTarget: 'verifyResult.output',
  });
  if (blob) {
    verifyResult.outputBlob = blob;
  }
}

async function externalizeToolAuditTextFields(args: {
  auditDir: string;
  timestamp: string;
  sanitizedContext: Record<string, unknown> | null;
}): Promise<void> {
  const { auditDir, timestamp, sanitizedContext } = args;
  if (!sanitizedContext) return;

  const toolAuditLogs = sanitizedContext.toolAuditLogs as any;
  if (!Array.isArray(toolAuditLogs) || toolAuditLogs.length === 0) return;

  const blobDir = path.join(auditDir, 'blobs');

  for (const entry of toolAuditLogs) {
    if (!entry || typeof entry !== 'object') continue;
    await externalizeToolAuditTextField({
      blobDir,
      timestamp,
      entry,
      field: 'inputSummary',
      blobPrefix: 'tool-inputSummary',
      auditTarget: 'toolAuditLogs.inputSummary',
    });
    await externalizeToolAuditTextField({
      blobDir,
      timestamp,
      entry,
      field: 'outputSummary',
      blobPrefix: 'tool-outputSummary',
      auditTarget: 'toolAuditLogs.outputSummary',
    });
  }
}

async function externalizeToolAuditTextField(args: {
  blobDir: string;
  timestamp: string;
  entry: Record<string, unknown>;
  field: 'inputSummary' | 'outputSummary';
  blobPrefix: string;
  auditTarget: string;
}): Promise<void> {
  const { blobDir, timestamp, entry, field, blobPrefix, auditTarget } = args;
  const raw = entry[field];
  if (typeof raw !== 'string') return;
  if (raw.length <= LIMITS.auditToolSummaryMaxInlineChars) return;

  entry[field] = buildToolSummaryPreview(raw);
  entry[`${field}Truncated`] = true;

  const sha256 = sha256Hex(raw);
  const blobName = `${blobPrefix}-${timestamp}-${sha256.slice(0, 8)}.log`;
  const blob = await writeBlobBestEffort({ blobDir, blobName, content: raw, auditTarget });
  if (blob) {
    entry[`${field}Blob`] = blob;
  }
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
    safe.toolCallingAudit = typed.toolCallingAudit.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry as any;
      const typedEntry = entry as unknown as Record<string, unknown>;
      const keepArgsPreview = typedEntry.toolResultErrorCode === 'INVALID_INPUT';
      if (keepArgsPreview) return entry;

      const {
        rawArgsPreview: _rawArgsPreview,
        parsedArgsPreview: _parsedArgsPreview,
        toolResultErrorMessage: _toolResultErrorMessage,
        ...rest
      } = typedEntry as Record<string, unknown>;
      return rest;
    });
  }

  if (typed.toolAuditLogger?.getLogs) {
    safe.toolAuditLogs = typed.toolAuditLogger.getLogs();
  }

  return safe;
}
