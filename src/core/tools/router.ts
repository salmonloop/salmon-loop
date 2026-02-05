import * as crypto from 'crypto';

import { LIMITS } from '../limits.js';
import { logger } from '../logger.js';

import { ToolAuditLogger } from './audit.js';
import type { ToolAuthorizationProvider } from './authorization/types.js';
import { BudgetGuard } from './budget.js';
import { ToolPolicy } from './policy.js';
import { ToolRegistry } from './registry.js';
import { ToolSanitizer } from './sanitize.js';
import { ToolCallEnvelope, ToolResult } from './types.js';

export class ToolRouter {
  private authorizationCache = new Map<string, { expiresAt?: number }>();

  constructor(
    private registry: ToolRegistry,
    private policy: ToolPolicy,
    private budget: BudgetGuard,
    private audit: ToolAuditLogger,
    private sanitizer: ToolSanitizer,
    private authorization?: ToolAuthorizationProvider,
  ) {}

  getSpec(toolName: string) {
    return this.registry.getSpec(toolName);
  }

  /**
   * ToolRouter.call is the single entry point for system tool execution.
   * It enforces standardized security, resource, and audit workflows.
   */
  async call(envelope: ToolCallEnvelope): Promise<ToolResult> {
    const startedAt = Date.now();

    // 1. Registry Resolve: Find tool specification
    const spec = this.registry.getSpec(envelope.toolName);
    if (!spec) {
      const result = this.createErrorResult(
        envelope,
        startedAt,
        'denied',
        'TOOL_NOT_FOUND',
        `Tool ${envelope.toolName} not found`,
      );
      this.audit.onEnd(result);
      return result;
    }

    // Start audit (record intent)
    this.audit.onStart(envelope, spec, { allowed: true });

    try {
      // 2. Input Validation: Validate parameters using Zod Schema
      const inputCheck = this.sanitizer.validateInput(spec, envelope.args);
      if (!inputCheck.ok) {
        throw { code: 'INVALID_INPUT', message: inputCheck.message };
      }

      // 3. Policy Gating: Phase and side-effect security admission
      const decision = this.policy.decide(envelope.phase, spec, envelope.ctx);
      if (!decision.allowed) {
        const result = this.createErrorResult(
          envelope,
          startedAt,
          'denied',
          'POLICY_DENY',
          decision.denyReason || 'Policy denied',
        );
        this.audit.onEnd(result);
        return result;
      }

      // 4. Authorization Gate: User approval for risky tool calls
      if (this.authorization) {
        const authorized = await this.authorizeToolCall(envelope, spec);
        if (!authorized.allowed) {
          const result = this.createErrorResult(
            envelope,
            startedAt,
            'denied',
            'AUTH_DENIED',
            authorized.reason || 'Authorization denied',
            {
              authorization: {
                outcome: 'deny',
                reason: authorized.reason,
                source: authorized.source,
              },
            },
          );
          this.audit.onEnd(result);
          return result;
        }
      }

      // 5. Budget Gating & Execution: Concurrency control, timeout, and execution
      const rawOutput = await this.budget.runWithGuards({
        timeoutMs: LIMITS.defaultToolTimeoutMs,
        maxOutputBytes: LIMITS.maxToolOutputBytes,
        phase: envelope.phase,
        toolName: spec.name,
        riskLevel: spec.riskLevel,
        // Inject phase into the runtime ctx for executors that need it (e.g. backend routing).
        fn: () => spec.executor(envelope.args, { ...envelope.ctx, phase: envelope.phase } as any),
      });

      // 5. Output Validation & Sanitize: Result validation and sensitive summary
      const sanitized = this.sanitizer.sanitizeOutput(spec, rawOutput);
      if (!sanitized.ok) {
        throw { code: 'INVALID_OUTPUT', message: sanitized.message };
      }

      // 6. Return Standard Result (ok)
      const durationMs = Date.now() - startedAt;
      const result: ToolResult = {
        id: envelope.id,
        toolName: spec.name,
        source: spec.source,
        status: 'ok',
        output: sanitized.output,
        summary: sanitized.summary,
        durationMs,
      };

      this.audit.onEnd(result);
      return result;
    } catch (e: any) {
      const errorCode = e.code || 'RUNTIME_ERROR';
      const errorMessage = e.message || String(e);

      const result = this.createErrorResult(
        envelope,
        startedAt,
        errorCode === 'TIMEOUT' ? 'timeout' : 'error',
        errorCode,
        errorMessage,
      );

      this.audit.onEnd(result);
      return result;
    }
  }

  private createErrorResult(
    envelope: ToolCallEnvelope,
    startedAt: number,
    status: 'ok' | 'denied' | 'error' | 'timeout',
    code: string,
    message: string,
    meta?: Record<string, any>,
  ): ToolResult {
    const durationMs = Date.now() - startedAt;
    return {
      id: envelope.id,
      toolName: envelope.toolName,
      source: 'builtin', // Default value for degradation
      status,
      durationMs,
      meta,
      error: {
        code,
        message,
        retryable: code === 'TIMEOUT' || code === 'BUDGET_CONCURRENCY',
      },
    };
  }

  private buildAuthorizationKey(envelope: ToolCallEnvelope): string {
    return `${envelope.toolName}:${envelope.phase}`;
  }

  private isAuthorizationCached(key: string): boolean {
    const entry = this.authorizationCache.get(key);
    if (!entry) return false;
    if (typeof entry.expiresAt === 'number' && Date.now() > entry.expiresAt) {
      this.authorizationCache.delete(key);
      return false;
    }
    return true;
  }

  private summarizeArgs(args: unknown, maxLength = 1200): string | undefined {
    if (args === undefined) return undefined;
    try {
      const raw = JSON.stringify(args);
      if (raw.length <= maxLength) return raw;
      return `${raw.slice(0, maxLength)}...`;
    } catch {
      return '[Unserializable]';
    }
  }

  private hashArgs(args: unknown): string | undefined {
    if (args === undefined) return undefined;
    try {
      const raw = JSON.stringify(args);
      return crypto.createHash('sha256').update(raw).digest('hex');
    } catch {
      return undefined;
    }
  }

  private async authorizeToolCall(
    envelope: ToolCallEnvelope,
    spec: { name: string; source: string; riskLevel: string; sideEffects?: string[] },
  ): Promise<{ allowed: boolean; reason?: string; source?: string }> {
    if (!this.authorization) return { allowed: true };

    const cacheKey = this.buildAuthorizationKey(envelope);
    if (this.isAuthorizationCached(cacheKey)) {
      this.audit.onAuthorization({
        callId: envelope.id,
        phase: envelope.phase,
        toolName: spec.name,
        outcome: 'allow_session',
        reason: 'cache',
        source: 'cache',
        riskLevel: spec.riskLevel,
        sideEffects: spec.sideEffects,
      });
      return { allowed: true };
    }

    const argsSummary = this.summarizeArgs(envelope.args);
    const argsHash = this.hashArgs(envelope.args);
    const decision = await this.authorization.requestAuthorization({
      id: envelope.id,
      toolName: spec.name,
      source: spec.source as any,
      phase: envelope.phase,
      riskLevel: spec.riskLevel as any,
      sideEffects: (spec.sideEffects || []) as any,
      argsSummary,
      argsHash,
      repoRoot: envelope.ctx.repoRoot,
      worktreeRoot: envelope.ctx.worktreeRoot,
      attemptId: envelope.ctx.attemptId,
      model: envelope.ctx.model,
      timestamp: Date.now(),
    });

    this.audit.onAuthorization({
      callId: envelope.id,
      phase: envelope.phase,
      toolName: spec.name,
      outcome: decision.outcome,
      reason: decision.reason,
      source: decision.source,
      riskLevel: spec.riskLevel,
      sideEffects: spec.sideEffects,
      ttlMs: decision.ttlMs,
    });

    if (decision.outcome === 'deny') {
      logger.warn(`Authorization denied for tool ${spec.name}`);
      return { allowed: false, reason: decision.reason, source: decision.source };
    }

    if (decision.outcome === 'allow_session' || decision.outcome === 'allow') {
      const expiresAt =
        typeof decision.ttlMs === 'number' ? Date.now() + decision.ttlMs : undefined;
      this.authorizationCache.set(cacheKey, { expiresAt });
    }

    return { allowed: true };
  }
}
