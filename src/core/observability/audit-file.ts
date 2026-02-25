import path from 'path';

import { text } from '../../locales/index.js';
import { appendFile, mkdir, readFile, rename, writeFile } from '../adapters/fs/node-fs.js';
import { getAuditDir } from '../runtime/paths.js';

import { getAuditTrail } from './audit-trail.js';
import { logger } from './logger.js';

interface AppendAuditParams {
  auditPath?: string;
  repoPath?: string;
  failureReason?: string;
  runId?: string;
}

interface AuditEventsRef {
  path: string;
  count?: number;
  firstTs?: string;
  lastTs?: string;
  sha256?: string;
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

function resolveEventsPath(eventsPath: string, auditPath: string): string {
  if (path.isAbsolute(eventsPath)) return eventsPath;
  return path.join(path.dirname(auditPath), eventsPath);
}

function buildEventsPayload(events: unknown[]): string {
  if (events.length === 0) return '';
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
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
  const eventsFilename = filename.replace(/\.json$/, '.events.jsonl');
  const eventsPath = path.join(auditDir, eventsFilename);

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
      eventsRef: {
        path: eventsFilename,
        count: trail.length,
        firstTs: trail[0]?.timestamp,
        lastTs: trail[trail.length - 1]?.timestamp,
      },
    },
  };

  await writeFile(eventsPath, buildEventsPayload(trail), 'utf8');
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

    const fullTrail = getAuditTrail();
    const eventsRef = (context as any).eventsRef as AuditEventsRef | undefined;
    if (!eventsRef?.path) {
      throw new Error('Invalid audit file: context.eventsRef.path is required');
    }

    const existingCount =
      typeof eventsRef.count === 'number' && Number.isFinite(eventsRef.count) ? eventsRef.count : 0;
    const delta = fullTrail.slice(existingCount);
    if (delta.length === 0) return;

    const eventsPath = resolveEventsPath(eventsRef.path, auditPath);
    await appendFile(eventsPath, buildEventsPayload(delta), 'utf8');

    (context as any).eventsRef = {
      ...eventsRef,
      count: existingCount + delta.length,
      firstTs: eventsRef.firstTs ?? delta[0]?.timestamp,
      lastTs: delta[delta.length - 1]?.timestamp ?? eventsRef.lastTs,
    };
    (data as any).context = context;

    await writeJsonAtomic(auditPath, data);
    return auditPath;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(text.grizzco.audit.appendFailed(msg));
    return undefined;
  }
}
