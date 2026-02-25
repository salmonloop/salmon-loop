import { resolve } from 'path';

import { readFile, stat } from '../../../core/adapters/fs/node-fs.js';
import { LIMITS } from '../../../core/config/limits.js';
import { JsonSchemaValidator } from '../../../core/structured-output/index.js';
import type { LoopResult } from '../../../core/types/index.js';

import type { OutputFormat } from './types.js';

export interface StructuredOutputState {
  ok: boolean;
  candidate: unknown | null;
  errorCode?: string;
  errorReason?: string;
  errorKind?: 'validation_failed' | 'schema_invalid';
}

export async function loadJsonSchema(params: {
  schema: string;
  repoPath: string;
}): Promise<unknown> {
  const value = params.schema.trim();
  if (!value) throw new Error('Empty schema');

  const maxBytes = LIMITS.maxJsonSchemaBytes;
  const inputBytes = Buffer.byteLength(value, 'utf8');
  if (inputBytes > maxBytes) {
    throw new Error(
      `Schema input exceeds maximum size: ${inputBytes} bytes (max ${maxBytes} bytes).`,
    );
  }

  if (value.startsWith('{') || value.startsWith('[')) {
    return JSON.parse(value);
  }

  const schemaPath = resolve(params.repoPath, value);
  const stats = await stat(schemaPath);
  if (typeof stats?.size === 'number' && stats.size > maxBytes) {
    throw new Error(
      `Schema input exceeds maximum size: ${stats.size} bytes (max ${maxBytes} bytes).`,
    );
  }
  const raw = await readFile(schemaPath, 'utf8');
  return JSON.parse(raw);
}

export async function buildStructuredOutputState(params: {
  outputFormat: OutputFormat;
  jsonSchemaSpec?: string;
  result: LoopResult;
  repoPath: string;
  instruction: string;
  sessionIdForOutput?: string;
  exitCode: number;
  reasonCode?: string;
}): Promise<StructuredOutputState> {
  if (params.outputFormat !== 'json' || !params.jsonSchemaSpec || !params.result.success) {
    return { ok: true, candidate: null };
  }

  try {
    const schema = await loadJsonSchema({
      schema: params.jsonSchemaSpec,
      repoPath: params.repoPath,
    });
    const validator = new JsonSchemaValidator();

    const candidate = {
      command: 'run',
      repo_path: params.repoPath,
      instruction: params.instruction,
      session_id: params.sessionIdForOutput,
      success: Boolean(params.result.success),
      exit_code: params.exitCode,
      reason: params.result.reason,
      reason_code: params.reasonCode,
      attempts: params.result.attempts,
      changed_files: params.result.changedFiles ?? [],
      audit_path: params.result.auditPath,
      error_code: params.result.errorCode,
      authorization_summary: params.result.authorizationSummary,
      authorization_decisions: Array.isArray(params.result.authorizationDecisions)
        ? params.result.authorizationDecisions.map((d) => ({
            call_id: d.callId,
            tool_name: d.toolName,
            phase: d.phase,
            outcome: d.outcome,
            source: d.source,
            reason: d.reason,
            ttl_ms: d.ttlMs,
            persist: d.persist,
            risk_level: d.riskLevel,
            side_effects: d.sideEffects,
            timestamp: d.timestamp,
          }))
        : undefined,
      usage: params.result.usage
        ? {
            input_tokens: params.result.usage.inputTokens,
            output_tokens: params.result.usage.outputTokens,
            total_tokens: params.result.usage.totalTokens,
          }
        : undefined,
      budget_summary: params.result.budgetSummary
        ? {
            attempt_count: params.result.budgetSummary.attemptCount,
            adjustment_count: params.result.budgetSummary.adjustmentCount,
            alert_count: params.result.budgetSummary.alertCount,
            critical_drop_count: params.result.budgetSummary.criticalDropCount,
            avg_utilization: params.result.budgetSummary.avgUtilization,
            truncation_rate: params.result.budgetSummary.truncationRate,
            success_rate: params.result.budgetSummary.successRate,
          }
        : undefined,
    };

    const validation = validator.validate({ schema, data: candidate });
    if (!validation.ok) {
      return {
        ok: false,
        candidate,
        errorCode: validation.error?.code,
        errorReason: validation.error?.message,
        errorKind: 'validation_failed',
      };
    }

    return { ok: true, candidate };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      candidate: null,
      errorCode: 'SCHEMA_INVALID',
      errorReason: msg,
      errorKind: 'schema_invalid',
    };
  }
}
