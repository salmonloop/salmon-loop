import { ToolAuditLogger } from './audit';
import { BudgetGuard } from './budget';
import { ToolPolicy } from './policy';
import { ToolRegistry } from './registry';
import { ToolSanitizer } from './sanitize';
import { ToolCallEnvelope, ToolResult } from './types';

export class ToolRouter {
  constructor(
    private registry: ToolRegistry,
    private policy: ToolPolicy,
    private budget: BudgetGuard,
    private audit: ToolAuditLogger,
    private sanitizer: ToolSanitizer,
  ) {}

  /**
   * ToolRouter.call 是系统工具执行的唯一单出口。
   * 它强制执行规范化的安全、资源与审计流程。
   */
  async call(envelope: ToolCallEnvelope): Promise<ToolResult> {
    const startedAt = Date.now();

    // 1. Registry Resolve: 查找工具规范
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

    // 审计开始 (记录意图)
    this.audit.onStart(envelope, spec, { allowed: true });

    try {
      // 2. Input Validation: 使用 Zod Schema 校验参数
      const inputCheck = this.sanitizer.validateInput(spec, envelope.args);
      if (!inputCheck.ok) {
        throw { code: 'INVALID_INPUT', message: inputCheck.message };
      }

      // 3. Policy Gating: 阶段与副作用安全准入
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

      // 4. Budget Gating & Execution: 并发控制、超时与执行
      const rawOutput = await this.budget.runWithGuards({
        timeoutMs: 30000, // 可后续从配置读取
        maxOutputBytes: 1024 * 1024,
        phase: envelope.phase,
        toolName: spec.name,
        riskLevel: spec.riskLevel,
        fn: () => spec.executor(envelope.args, envelope.ctx),
      });

      // 5. Output Validation & Sanitize: 结果校验与脱敏摘要
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
      source: 'builtin', // 降级默认值
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
