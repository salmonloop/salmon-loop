import * as crypto from 'crypto';

import { tryGetLogger } from '../observability/logger.js';

/**
 * Structured audit event for skill execution tracking.
 *
 * Emitted at the start, end, and denial of every skill execution
 * across both slash-governed and tool-bridge routes.
 *
 * Validates: Requirements 1.5, 1.6, 9.1, 9.2, 9.3
 */
export interface SkillAuditEvent {
  type: 'SKILL_EXECUTION_START' | 'SKILL_EXECUTION_END' | 'SKILL_EXECUTION_DENIED';
  skillId: string;
  route: 'slash-governed' | 'tool-bridge';
  runnerClass: string;
  commandCount: number;
  authorizationMode: 'blocking' | 'deferred';
  argsHash?: string;
  traceId: string;
  denyReason?: string;
  denySource?: string;
  durationMs?: number;
}

/**
 * Compute a stable SHA-256 hash (truncated to 16 hex chars) of the given arguments text.
 */
export function hashSkillArgs(argsText: string): string | undefined {
  if (!argsText) return undefined;
  return crypto.createHash('sha256').update(argsText).digest('hex').slice(0, 16);
}

/**
 * Generate a unique trace ID for a skill execution.
 */
export function generateSkillTraceId(skillId: string): string {
  return `skill-${skillId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Emit a structured skill audit event via the logger audit trail.
 *
 * Uses `logger.audit()` to ensure events are persisted in the audit trail
 * with appropriate severity and source metadata.
 */
export function emitSkillAuditEvent(event: SkillAuditEvent): void {
  const logger = tryGetLogger();
  if (!logger) return;

  const severity = event.type === 'SKILL_EXECUTION_DENIED' ? 'high' : 'low';

  logger.audit(event.type, event, {
    source: 'skill-executor',
    severity,
    scope: 'session',
  });
}
