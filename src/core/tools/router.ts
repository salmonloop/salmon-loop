import { LIMITS } from '../limits.js';

import { ToolAuditLogger } from './audit.js';
import { BudgetGuard } from './budget.js';
import { ToolPolicy } from './policy.js';
import { ToolRegistry } from './registry.js';
import { ToolSanitizer } from './sanitize.js';
import { ToolCallEnvelope, ToolResult } from './types.js';

export class ToolRouter {
  constructor(
    private registry: ToolRegistry,
    private policy: ToolPolicy,
    private budget: BudgetGuard,
    private audit: ToolAuditLogger,
    private sanitizer: ToolSanitizer,
  ) {}

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

      // 4. Budget Gating & Execution: Concurrency control, timeout, and execution
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
  ): ToolResult {
    const durationMs = Date.now() - startedAt;
    return {
      id: envelope.id,
      toolName: envelope.toolName,
      source: 'builtin', // Default value for degradation
      status,
      durationMs,
      error: {
        code,
        message,
        retryable: code === 'TIMEOUT' || code === 'BUDGET_CONCURRENCY',
      },
    };
  }
}
