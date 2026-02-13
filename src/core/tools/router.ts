import * as crypto from 'crypto';

import { LIMITS } from '../config/limits.js';
import { logger } from '../observability/logger.js';

import { ToolAuditLogger } from './audit.js';
import type { ToolAuthorizationProvider, ToolAuthorizationRequest } from './authorization/types.js';
import { BudgetGuard } from './budget.js';
import { ToolPolicy } from './policy.js';
import { ToolRegistry } from './registry.js';
import { ToolSanitizer } from './sanitize.js';
import { ToolCallEnvelope, ToolResult } from './types.js';

export class ToolRouter {
  private authorizationCache = new Map<string, { expiresAt?: number }>();
  private authorizationMode: 'blocking' | 'deferred';

  constructor(
    private registry: ToolRegistry,
    private policy: ToolPolicy,
    private budget: BudgetGuard,
    private audit: ToolAuditLogger,
    private sanitizer: ToolSanitizer,
    private authorization?: ToolAuthorizationProvider,
    options?: { authorizationMode?: 'blocking' | 'deferred' },
  ) {
    this.authorizationMode = options?.authorizationMode ?? 'blocking';
  }

  getSpec(toolName: string) {
    return this.registry.getSpec(toolName);
  }

  async waitForAuthorization(requestId: string, signal?: AbortSignal): Promise<boolean> {
    if (!this.authorization?.waitForAuthorization) return false;
    const decision = await this.authorization.waitForAuthorization(requestId, signal);
    return Boolean(decision);
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
      const normalizedArgs = inputCheck.value ?? envelope.args;
      const normalizedEnvelope =
        normalizedArgs === envelope.args ? envelope : { ...envelope, args: normalizedArgs };

      // 3. Policy Gating: Phase and side-effect security admission
      const decision = this.policy.decide(normalizedEnvelope.phase, spec, normalizedEnvelope.ctx);
      if (!decision.allowed) {
        const result = this.createErrorResult(
          normalizedEnvelope,
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
        const auth = await this.authorizeToolCall(normalizedEnvelope, spec);
        if (auth.kind === 'deny') {
          const result = this.createErrorResult(
            normalizedEnvelope,
            startedAt,
            'denied',
            'AUTH_DENIED',
            auth.reason || 'Authorization denied',
            {
              authorization: {
                outcome: 'deny',
                reason: auth.reason,
                source: auth.source,
              },
            },
          );
          this.audit.onEnd(result);
          return result;
        }
        if (auth.kind === 'pending') {
          const result = this.createErrorResult(
            normalizedEnvelope,
            startedAt,
            'denied',
            'AUTH_REQUIRED',
            auth.message,
            {
              authorization: {
                outcome: 'pending',
                challenge: auth.challenge,
                source: auth.source,
              },
            },
          );
          // Provide a stable token for challenge-response UIs.
          (result.error as any).confirmToken = auth.challenge;
          this.audit.onEnd(result);
          return result;
        }
      }

      // 5. Budget Gating & Execution: Concurrency control, timeout, and execution
      const rawOutput = await this.budget.runWithGuards({
        timeoutMs: LIMITS.defaultToolTimeoutMs,
        maxOutputBytes: LIMITS.maxToolOutputBytes,
        phase: normalizedEnvelope.phase,
        toolName: spec.name,
        riskLevel: spec.riskLevel,
        // Inject phase into the runtime ctx for executors that need it (e.g. backend routing).
        fn: () =>
          spec.executor(normalizedEnvelope.args, {
            ...normalizedEnvelope.ctx,
            phase: normalizedEnvelope.phase,
          } as any),
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
        outputSummary: sanitized.summary,
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

  /**
   * Best-effort deferred authorization preflight.
   *
   * This is intended for schedulers that want to avoid holding locks while waiting for user input.
   * It only runs when:
   * - authorizationMode === 'deferred'
   * - authorizationProvider.requestAuthorizationDeferred exists
   *
   * For blocking authorization or missing providers, it returns null and the caller should proceed.
   */
  async preflightDeferredAuthorization(
    envelope: ToolCallEnvelope,
  ): Promise<
    | null
    | { kind: 'ready' }
    | { kind: 'pending'; message: string; challenge: string; toolResult: ToolResult }
    | { kind: 'denied'; toolResult: ToolResult }
  > {
    if (
      this.authorizationMode !== 'deferred' ||
      !this.authorization?.requestAuthorizationDeferred
    ) {
      return null;
    }

    const startedAt = Date.now();

    const spec = this.registry.getSpec(envelope.toolName);
    if (!spec) {
      const toolResult = this.createErrorResult(
        envelope,
        startedAt,
        'denied',
        'TOOL_NOT_FOUND',
        `Tool ${envelope.toolName} not found`,
      );
      return { kind: 'denied', toolResult };
    }

    const inputCheck = this.sanitizer.validateInput(spec, envelope.args);
    if (!inputCheck.ok) {
      const toolResult = this.createErrorResult(
        envelope,
        startedAt,
        'error',
        'INVALID_INPUT',
        inputCheck.message || 'Invalid input',
      );
      return { kind: 'denied', toolResult };
    }
    const normalizedArgs = inputCheck.value ?? envelope.args;
    const normalizedEnvelope =
      normalizedArgs === envelope.args ? envelope : { ...envelope, args: normalizedArgs };

    const decision = this.policy.decide(normalizedEnvelope.phase, spec, normalizedEnvelope.ctx);
    if (!decision.allowed) {
      const toolResult = this.createErrorResult(
        normalizedEnvelope,
        startedAt,
        'denied',
        'POLICY_DENY',
        decision.denyReason || 'Policy denied',
      );
      return { kind: 'denied', toolResult };
    }

    const cacheKey = this.buildAuthorizationKey(normalizedEnvelope);
    if (this.isAuthorizationCached(cacheKey)) {
      return { kind: 'ready' };
    }

    const argsSummary = await this.getAuthorizationArgsSummary(normalizedEnvelope, spec);
    const argsHash = this.hashArgs(normalizedEnvelope.args);
    const req: ToolAuthorizationRequest = {
      id: normalizedEnvelope.id,
      toolName: spec.name,
      source: spec.source as any,
      phase: normalizedEnvelope.phase,
      riskLevel: spec.riskLevel as any,
      sideEffects: (spec.sideEffects || []) as any,
      argsSummary,
      argsHash,
      repoRoot: normalizedEnvelope.ctx.repoRoot,
      worktreeRoot: normalizedEnvelope.ctx.worktreeRoot,
      attemptId: normalizedEnvelope.ctx.attemptId,
      model: normalizedEnvelope.ctx.model,
      timestamp: Date.now(),
    };

    const deferred = await this.authorization.requestAuthorizationDeferred(req);
    if (deferred.kind === 'pending') {
      const toolResult = this.createErrorResult(
        normalizedEnvelope,
        startedAt,
        'denied',
        'AUTH_REQUIRED',
        deferred.message,
        {
          authorization: {
            outcome: 'pending',
            challenge: deferred.challenge,
            source: 'user',
          },
        },
      );
      (toolResult.error as any).confirmToken = deferred.challenge;

      return {
        kind: 'pending',
        message: deferred.message,
        challenge: deferred.challenge,
        toolResult,
      };
    }

    const decisionResult = deferred.decision;
    if (decisionResult.outcome === 'deny') {
      const toolResult = this.createErrorResult(
        normalizedEnvelope,
        startedAt,
        'denied',
        'AUTH_DENIED',
        decisionResult.reason || 'Authorization denied',
        {
          authorization: {
            outcome: 'deny',
            reason: decisionResult.reason,
            source: decisionResult.source,
          },
        },
      );
      return { kind: 'denied', toolResult };
    }

    return { kind: 'ready' };
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
        retryable: code === 'TIMEOUT' || code === 'BUDGET_CONCURRENCY' || code === 'AUTH_REQUIRED',
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
  ): Promise<
    | { kind: 'allow' }
    | { kind: 'deny'; reason?: string; source?: string }
    | { kind: 'pending'; message: string; challenge: string; source?: string }
  > {
    if (!this.authorization) return { kind: 'allow' };

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
      return { kind: 'allow' };
    }

    const argsSummary = await this.getAuthorizationArgsSummary(envelope, spec as any);
    const argsHash = this.hashArgs(envelope.args);
    const req = {
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
    };

    if (this.authorizationMode === 'deferred' && this.authorization.requestAuthorizationDeferred) {
      const deferred = await this.authorization.requestAuthorizationDeferred(req);
      if (deferred.kind === 'pending') {
        this.audit.onAuthorization({
          callId: envelope.id,
          phase: envelope.phase,
          toolName: spec.name,
          outcome: 'pending',
          reason: deferred.message,
          source: 'user',
          riskLevel: spec.riskLevel,
          sideEffects: spec.sideEffects,
        });
        return {
          kind: 'pending',
          message: deferred.message,
          challenge: deferred.challenge,
          source: 'user',
        };
      }

      const decision = deferred.decision;
      return this.applyAuthorizationDecision(envelope, spec, decision);
    }

    const decision = await this.authorization.requestAuthorization(req);
    return this.applyAuthorizationDecision(envelope, spec, decision);
  }

  private applyAuthorizationDecision(
    envelope: ToolCallEnvelope,
    spec: { name: string; source: string; riskLevel: string; sideEffects?: string[] },
    decision: { outcome: string; reason?: string; source?: string; ttlMs?: number },
  ): { kind: 'allow' } | { kind: 'deny'; reason?: string; source?: string } {
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
      return { kind: 'deny', reason: decision.reason, source: decision.source };
    }

    if (decision.outcome === 'allow_session' || decision.outcome === 'allow') {
      const expiresAt =
        typeof decision.ttlMs === 'number' ? Date.now() + decision.ttlMs : undefined;
      const cacheKey = this.buildAuthorizationKey(envelope);
      this.authorizationCache.set(cacheKey, { expiresAt });
    }

    return { kind: 'allow' };
  }

  private async getAuthorizationArgsSummary(
    envelope: ToolCallEnvelope,
    spec: { name: string; source?: string; summarizeArgsForAuthorization?: any },
  ): Promise<string | undefined> {
    const fallback = this.summarizeArgs(envelope.args);
    const summarize = (spec as any)?.summarizeArgsForAuthorization;
    if (typeof summarize !== 'function') return fallback;

    // Best-effort only. Avoid hanging authorization prompts on slow IO.
    const TIMEOUT_MS = 1500;
    try {
      const phaseCtx = { ...envelope.ctx, phase: envelope.phase } as any;
      const result = await Promise.race([
        Promise.resolve(summarize(envelope.args, phaseCtx)),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), TIMEOUT_MS)),
      ]);
      return typeof result === 'string' && result.trim() ? result : fallback;
    } catch {
      return fallback;
    }
  }
}
