import { readFile, writeFile } from 'fs/promises';

import { text } from '../../locales/index.js';

import { getAuditTrail } from './audit-trail.js';
import { logger } from './logger.js';

export async function appendAuditTrailToAuditFile(auditPath: string | undefined): Promise<void> {
  if (!auditPath) return;

  try {
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

    await writeFile(auditPath, JSON.stringify(data, null, 2));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn(text.grizzco.audit.appendFailed(msg));
  }
}
