import { text } from '../../locales/index.js';
import { logger } from '../logger.js';
import { ExecutionPhase, Phase } from '../types.js';

import { PolicyDecision } from './policy.js';
import { ToolCallEnvelope, ToolResult, ToolSpec } from './types.js';

export interface ToolAuditLogEntry {
  timestamp: string;
  eventType: 'start' | 'end' | 'authorization';
  callId: string;
  phase: ExecutionPhase;
  toolName: string;
  // Start event fields
  inputSummary?: string; // stringified and truncated
  decision?: PolicyDecision;
  // End event fields
  status?: string;
  durationMs?: number;
  outputSummary?: string;
  error?: string;
  authOutcome?: string;
  authReason?: string;
  authRiskLevel?: string;
  authSideEffects?: string[];
  authTtlMs?: number;
  authSource?: string;
}

export class ToolAuditLogger {
  private logs: ToolAuditLogEntry[] = [];

  onStart(call: ToolCallEnvelope, spec: ToolSpec, decision: PolicyDecision) {
    const entry: ToolAuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'start',
      callId: call.id,
      phase: call.phase,
      toolName: spec.name,
      inputSummary: this.summarize(call.args),
      decision,
    };
    this.logs.push(entry);
    logger.debug(text.audit.event('Start', spec.name, decision.allowed ? 'allowed' : 'denied'));
  }

  onEnd(result: ToolResult) {
    // We need to find the phase from the callId if we weren't passed it,
    // but for now we'll assume the caller context is sufficient or we log what we have.
    // Ideally we'd map ID back to call, but to keep it simple/stateless:

    const entry: ToolAuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'end',
      callId: result.id,
      phase: result.error?.failurePhase || Phase.CONTEXT, // Fallback/hack, ideally passed in
      toolName: result.toolName,
      status: result.status,
      durationMs: result.durationMs,
      outputSummary: result.outputSummary,
      error: result.error?.code,
    };
    this.logs.push(entry);
    logger.debug(text.audit.event('End', result.toolName, result.status));
  }

  onAuthorization(event: {
    callId: string;
    phase: ExecutionPhase;
    toolName: string;
    outcome: string;
    reason?: string;
    source?: string;
    riskLevel?: string;
    sideEffects?: string[];
    ttlMs?: number;
  }) {
    const entry: ToolAuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'authorization',
      callId: event.callId,
      phase: event.phase,
      toolName: event.toolName,
      authOutcome: event.outcome,
      authReason: event.reason,
      authSource: event.source,
      authRiskLevel: event.riskLevel,
      authSideEffects: event.sideEffects,
      authTtlMs: event.ttlMs,
    };
    this.logs.push(entry);
    logger.debug(text.audit.event('Authorization', event.toolName, event.outcome));
  }

  /**
   * Receives fine-grained backend events (start, ok, fail) for auditing.
   */
  onEvent(event: any) {
    // For now, we just push them into the logs as a generic entry or log to debug
    // In the future, this can be structured into a separate backend-attempts table
    this.logs.push({
      timestamp: new Date().toISOString(),
      eventType: 'start', // Placeholder
      callId: 'backend-event',
      phase: event.phase || Phase.CONTEXT,
      toolName: event.backendId || 'unknown-backend',
      error: event.code,
      outputSummary: `Backend event: ${JSON.stringify(event)}`,
    });
  }

  getLogs() {
    return this.logs;
  }

  private summarize(data: unknown): string {
    try {
      const str = JSON.stringify(data);
      return str.length > 200 ? str.substring(0, 200) + '...' : str;
    } catch {
      return '[Circular/Unserializable]';
    }
  }
}
