import * as crypto from 'crypto';

import { z } from 'zod';

import { LIMITS } from '../config/limits.js';
import { getLogger } from '../observability/logger.js';

import { ToolAuditLogger } from './audit.js';
import type {
  AuthorizationDecision,
  ToolAuthorizationProvider,
  ToolAuthorizationRequest,
} from './authorization/types.js';
import { BudgetGuard } from './budget.js';
import type { CompiledPermissionRules } from './permissions/permission-rules.js';
import { decidePermissionForToolCall } from './permissions/permission-rules.js';
import { ToolPolicy } from './policy.js';
import { ToolRegistry } from './registry.js';
import { ToolSanitizer } from './sanitize.js';
import { ToolCallEnvelope, ToolResult, ToolSpec } from './types.js';

export class ToolRouter {
  private authorizationCache = new Map<string, { expiresAt?: number }>();
  private authorizationMode: 'blocking' | 'deferred';
  private permissionRules?: CompiledPermissionRules;

  private unwrapForHint(schema: z.ZodTypeAny): z.ZodTypeAny {
    let current: z.ZodTypeAny = schema;
    for (let depth = 0; depth < 20; depth++) {
      const ZodEffects: any = (z as any).ZodEffects;
      if (typeof ZodEffects === 'function' && current instanceof ZodEffects) {
        current = (current as any)._def.schema;
        continue;
      }
      if (current instanceof z.ZodPipe) {
        current = (current as any)._def.out;
        continue;
      }
      if (current instanceof z.ZodOptional) {
        current = (current as any)._def.innerType;
        continue;
      }
      if (current instanceof z.ZodNullable) {
        current = (current as any)._def.innerType;
        continue;
      }
      if (current instanceof z.ZodDefault) {
        current = (current as any)._def.innerType;
        continue;
      }
      break;
    }
    return current;
  }

  private buildInputHint(spec: ToolSpec): string | undefined {
    if (!spec.inputSchema) return undefined;
    const base = this.unwrapForHint(spec.inputSchema as any);
    if (!(base instanceof z.ZodObject)) return undefined;

    const shape = (base as any).shape as Record<string, z.ZodTypeAny>;
    const required: string[] = [];
    const parts: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      const isOptional = value.isOptional();
      if (!isOptional) required.push(key);

      const unwrapped = this.unwrapForHint(value);
      let typeName = 'unknown';
      if (unwrapped instanceof z.ZodString) typeName = 'string';
      else if (unwrapped instanceof z.ZodNumber) typeName = 'number';
      else if (unwrapped instanceof z.ZodBoolean) typeName = 'boolean';
      else if (unwrapped instanceof z.ZodArray) typeName = 'array';
      else if (unwrapped instanceof z.ZodObject) typeName = 'object';

      parts.push(`${key}: ${typeName}${isOptional ? ' (optional)' : ''}`);
    }

    if (parts.length === 0) return undefined;

    const requiredText = required.length > 0 ? ` Required keys: ${required.join(', ')}.` : '';
    return `Expected JSON object. Keys: ${parts.join(', ')}.${requiredText}`;
  }

  constructor(
    private registry: ToolRegistry,
    private policy: ToolPolicy,
    private budget: BudgetGuard,
    private audit: ToolAuditLogger,
    private sanitizer: ToolSanitizer,
    private authorization?: ToolAuthorizationProvider,
    options?: {
      authorizationMode?: 'blocking' | 'deferred';
      permissionRules?: CompiledPermissionRules;
    },
  ) {
    this.authorizationMode = options?.authorizationMode ?? 'blocking';
    this.permissionRules = options?.permissionRules;
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
        const hint = this.buildInputHint(spec);
        const message = hint
          ? `${inputCheck.message} (${hint})`
          : inputCheck.message || 'Invalid input';
        throw { code: 'INVALID_INPUT', message };
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

      const permissionDecision = await decidePermissionForToolCall({
        rules: this.permissionRules,
        toolName: spec.name,
        args: normalizedEnvelope.args,
        ctx: normalizedEnvelope.ctx,
      });
      if (permissionDecision.kind === 'deny') {
        const result = this.createErrorResult(
          normalizedEnvelope,
          startedAt,
          'denied',
          'PERMISSION_RULE_DENY',
          permissionDecision.reason,
          {
            authorization: {
              outcome: 'deny',
              reason: permissionDecision.reason,
              source: 'cli',
            },
          },
        );
        this.audit.onEnd(result);
        return result;
      }
      if (permissionDecision.kind === 'allow') {
        this.audit.onAuthorization({
          callId: normalizedEnvelope.id,
          phase: normalizedEnvelope.phase,
          toolName: spec.name,
          outcome: 'allow',
          reason: permissionDecision.reason,
          source: 'cli',
          riskLevel: spec.riskLevel,
          sideEffects: spec.sideEffects,
        });
      }

      // 4. Authorization Gate: User approval for risky tool calls
      if (this.authorization && permissionDecision.kind !== 'allow') {
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
        timeoutMs: spec.defaultTimeoutMs ?? LIMITS.defaultToolTimeoutMs,
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
    } catch (e: unknown) {
      let errorCode = 'RUNTIME_ERROR';
      let errorMessage = String(e);
      let errorMeta: Record<string, any> | undefined;

      if (e instanceof Error) {
        errorMessage = e.message;
        if ('code' in e && typeof (e as { code?: unknown }).code === 'string') {
          errorCode = (e as { code: string }).code;
        }
        if ('interrupt' in e) {
          errorMeta = { ...(errorMeta ?? {}), interrupt: (e as any).interrupt };
        }
        if ('inputRequired' in e) {
          errorMeta = { ...(errorMeta ?? {}), inputRequired: (e as any).inputRequired };
        }
      } else if (e && typeof e === 'object') {
        if ('message' in e && typeof (e as { message: unknown }).message === 'string') {
          errorMessage = (e as { message: string }).message;
        }
        if ('code' in e && typeof (e as { code?: unknown }).code === 'string') {
          errorCode = (e as { code: string }).code;
        }
        if ('interrupt' in e) {
          errorMeta = { ...(errorMeta ?? {}), interrupt: (e as any).interrupt };
        }
        if ('inputRequired' in e) {
          errorMeta = { ...(errorMeta ?? {}), inputRequired: (e as any).inputRequired };
        }
      }

      const result = this.createErrorResult(
        envelope,
        startedAt,
        errorCode === 'TIMEOUT' ? 'timeout' : 'error',
        errorCode,
        errorMessage,
        errorMeta,
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

    const permissionDecision = await decidePermissionForToolCall({
      rules: this.permissionRules,
      toolName: spec.name,
      args: normalizedEnvelope.args,
      ctx: normalizedEnvelope.ctx,
    });
    if (permissionDecision.kind === 'deny') {
      const toolResult = this.createErrorResult(
        normalizedEnvelope,
        startedAt,
        'denied',
        'PERMISSION_RULE_DENY',
        permissionDecision.reason,
        {
          authorization: {
            outcome: 'deny',
            reason: permissionDecision.reason,
            source: 'cli',
          },
        },
      );
      return { kind: 'denied', toolResult };
    }
    if (permissionDecision.kind === 'allow') {
      return { kind: 'ready' };
    }

    const cacheKey = this.buildAuthorizationKey(normalizedEnvelope, spec);
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

  private buildAuthorizationKey(
    envelope: ToolCallEnvelope,
    spec: { sideEffects?: string[] },
  ): string {
    const base = `${envelope.toolName}:${envelope.phase}`;
    if (this.isHighRiskTool(spec)) {
      const argsHash = this.hashArgs(envelope.args);
      return argsHash ? `${base}:${argsHash}` : base;
    }
    // Low-risk (read-only) tools use toolName:phase only — a single approval
    // covers all argument variations since these tools have no dangerous side effects.
    return base;
  }

  /**
   * Determines whether a tool is high-risk based on its declared side effects.
   * High-risk tools (process, fs_write, network) require stricter authorization
   * cache scoping — see {@link buildAuthorizationKey}.
   */
  private isHighRiskTool(spec: { sideEffects?: string[] }): boolean {
    const HIGH_RISK_EFFECTS: string[] = ['process', 'fs_write', 'network'];
    return (spec.sideEffects ?? []).some((e) => HIGH_RISK_EFFECTS.includes(e));
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
      // Full SHA-256 hex digest (64 chars / 256-bit) for authorization cache keys.
      // Truncation to 16 hex was insufficient collision resistance for security use.
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

    const cacheKey = this.buildAuthorizationKey(envelope, spec);
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
    decision: AuthorizationDecision,
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
      persist: decision.persist,
    });

    if (decision.outcome === 'deny') {
      getLogger().warn(`Authorization denied for tool ${spec.name}`);
      return { kind: 'deny', reason: decision.reason, source: decision.source };
    }

    if (decision.outcome === 'allow_session' || decision.outcome === 'allow') {
      const expiresAt =
        typeof decision.ttlMs === 'number' ? Date.now() + decision.ttlMs : undefined;
      const cacheKey = this.buildAuthorizationKey(envelope, spec);
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
