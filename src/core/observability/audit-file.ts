import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import path from 'path';

import { text } from '../../locales/index.js';
import { getAuditDir } from '../runtime/paths.js';

import { getAuditTrail } from './audit-trail.js';
import { logger } from './logger.js';

interface AppendAuditParams {
  auditPath?: string;
  repoPath?: string;
  failureReason?: string;
  runId?: string;
}

function toParams(input: string | undefined | AppendAuditParams): AppendAuditParams {
  if (typeof input === 'string' || input === undefined) {
    return { auditPath: input };
  }
  return input;
}

async function writeJsonAtomic(targetPath: string, data: unknown): Promise<void> {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const tmpPath = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}`);
  const payload = JSON.stringify(data, null, 2);

  await writeFile(tmpPath, payload);
  try {
    await rename(tmpPath, targetPath);
  } catch {
    // Retry once with a fresh temp file to reduce transient rename failures.
    const retryTmpPath = path.join(dir, `.${base}.tmp-${process.pid}-${Date.now()}-retry`);
    await writeFile(retryTmpPath, payload);
    await rename(retryTmpPath, targetPath);
  }
}

async function createFallbackAuditFile(params: AppendAuditParams): Promise<string | undefined> {
  if (!params.repoPath) return undefined;
  const trail = getAuditTrail();
  if (trail.length === 0) return undefined;

  const auditDir = getAuditDir(params.repoPath);
  await mkdir(auditDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `audit-fallback-${timestamp}.json`;
  const targetPath = path.join(auditDir, filename);

  const payload = {
    meta: {
      timestamp: new Date().toISOString(),
      success: false,
      error: params.failureReason,
      runId: params.runId,
      source: 'appendAuditTrailToAuditFile.fallback',
    },
    traces: [],
    context: {
      auditTrail: trail,
    },
  };

  await writeJsonAtomic(targetPath, payload);
  return targetPath;
}

export async function appendAuditTrailToAuditFile(
  input: string | undefined | AppendAuditParams,
): Promise<string | undefined> {
  const params = toParams(input);
  const auditPath = params.auditPath;

  try {
    if (!auditPath) {
      return await createFallbackAuditFile(params);
    }

    const raw = await readFile(auditPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, unknown>;

    const context =
      data.context && typeof data.context === 'object'
        ? (data.context as Record<string, unknown>)
        : {};

    const existingTrail = Array.isArray((context as any).auditTrail)
      ? (context as any).auditTrail
      : [];
    const fullTrail = getAuditTrail();
    const delta = fullTrail.slice(existingTrail.length);
    if (delta.length === 0) return;

    (context as any).auditTrail = [...existingTrail, ...delta];
    (data as any).context = context;

    await writeJsonAtomic(auditPath, data);
    return auditPath;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(text.grizzco.audit.appendFailed(msg));
    return undefined;
  }
}
