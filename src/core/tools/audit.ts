import { text } from '../../locales/index.js';
import { logger } from '../observability/logger.js';
import { AuthorizationSourceSummary, ExecutionPhase, Phase } from '../types/index.js';
import { sanitizeErrorMessage } from '../utils/sanitizer.js';

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
  errorMessage?: string;
  authOutcome?: string;
  authReason?: string;
  authRiskLevel?: string;
  authSideEffects?: string[];
  authTtlMs?: number;
  authSource?: string;
}

export interface ToolAuditLoggerOptions {
  onAuthorizationSummary?: (
    summary: AuthorizationSourceSummary,
    event: {
      callId: string;
      phase: ExecutionPhase;
      toolName: string;
      outcome: string;
      reason?: string;
      source?: string;
      riskLevel?: string;
      sideEffects?: string[];
      ttlMs?: number;
    },
  ) => void;
}

export class ToolAuditLogger {
  private logs: ToolAuditLogEntry[] = [];
  private callPhaseIndex = new Map<string, ExecutionPhase>();
  private authorizationSummary: AuthorizationSourceSummary = {
    auto: 0,
    allowlist: 0,
    user: 0,
    cache: 0,
  };

  constructor(private options?: ToolAuditLoggerOptions) {}

  onStart(call: ToolCallEnvelope, spec: ToolSpec, decision: PolicyDecision) {
    this.callPhaseIndex.set(call.id, call.phase);
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
    const phase =
      (result.id && this.callPhaseIndex.get(result.id)) ||
      result.error?.failurePhase ||
      Phase.CONTEXT;

    const entry: ToolAuditLogEntry = {
      timestamp: new Date().toISOString(),
      eventType: 'end',
      callId: result.id,
      phase,
      toolName: result.toolName,
      status: result.status,
      durationMs: result.durationMs,
      outputSummary: result.outputSummary ?? result.summary,
      error: result.error?.code,
      errorMessage: result.error?.message ? sanitizeErrorMessage(result.error.message) : undefined,
    };
    this.logs.push(entry);
    logger.debug(text.audit.event('End', result.toolName, result.status));

    if (result.id) {
      this.callPhaseIndex.delete(result.id);
    }
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

    const updated = this.updateAuthorizationSummary(event.source);
    if (updated && this.options?.onAuthorizationSummary) {
      this.options.onAuthorizationSummary({ ...this.authorizationSummary }, event);
    }
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

  getAuthorizationSummary() {
    return { ...this.authorizationSummary };
  }

  private summarize(data: unknown): string {
    try {
      const str = JSON.stringify(data);
      return str.length > 200 ? str.substring(0, 200) + '...' : str;
    } catch {
      return '[Circular/Unserializable]';
    }
  }

  private updateAuthorizationSummary(source?: string): boolean {
    if (!source) return false;
    if (source === 'auto') {
      this.authorizationSummary.auto += 1;
      return true;
    }
    if (source === 'allowlist') {
      this.authorizationSummary.allowlist += 1;
      return true;
    }
    if (source === 'user') {
      this.authorizationSummary.user += 1;
      return true;
    }
    if (source === 'cache') {
      this.authorizationSummary.cache += 1;
      return true;
    }
    return false;
  }
}
