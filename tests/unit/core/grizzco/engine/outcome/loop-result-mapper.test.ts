import { getGlobalAdjuster } from '../../../../../../src/core/context/budget/dynamic-adjuster.js';
import { recordBudgetAlert } from '../../../../../../src/core/context/budget/integration.js';
import { LoopTelemetry } from '../../../../../../src/core/grizzco/engine/observability/loop-telemetry.js';
import {
  buildLoopFailureResult,
  buildLoopResultFromTransaction,
} from '../../../../../../src/core/grizzco/engine/outcome/loop-result-mapper.js';
import type { FlowTransactionReport } from '../../../../../../src/core/grizzco/engine/transaction/types.js';
import {
  clearAuditTrail,
  recordAuditEvent,
} from '../../../../../../src/core/observability/audit-trail.js';
import { text } from '../../../../../../src/locales/index.js';

function createTelemetry() {
  return new LoopTelemetry(() => new Date('2026-02-13T00:00:00.000Z'));
}

describe('loop-result-mapper', () => {
  beforeEach(() => {
    clearAuditTrail();
    getGlobalAdjuster().reset();
  });

  afterEach(() => {
    clearAuditTrail();
    getGlobalAdjuster().reset();
  });

  it('maps success dry-run result', () => {
    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: true,
      attempts: 1,
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [],
      retryExhausted: false,
      lastContext: {
        diff: 'diff',
        changedFiles: ['a.ts'],
      } as any,
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: { dryRun: true } as any,
      telemetry,
      auditPath: '/tmp/audit.json',
    });

    expect(result.success).toBe(true);
    expect(result.reasonCode).toBe('DRY_RUN');
    expect(result.auditPath).toBe('/tmp/audit.json');
  });

  it('propagates artifact hints from transaction report', () => {
    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: true,
      attempts: 1,
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [],
      retryExhausted: false,
      lastVerifyArtifact: {
        handle: 's8p://artifact/verify-1',
        mimeType: 'text/plain',
        sha256: 'verify-1',
        size: 100,
      },
      lastSubAgentPatchArtifacts: [
        {
          handle: 's8p://artifact/subagent-patch-1',
          mimeType: 'text/x-diff',
          sha256: 'subagent-patch-1',
          size: 200,
        },
      ],
      lastRecentReadArtifacts: [
        {
          path: 'src/recent.ts',
          artifact: {
            handle: 's8p://artifact/recent-read-1',
            mimeType: 'text/plain',
            sha256: 'recent-read-1',
            size: 42,
          },
        },
      ],
      lastToolResultPreviewArtifacts: [
        {
          label: 'Tool result preview: web.search',
          artifact: {
            handle: 's8p://artifact/preview-1',
            mimeType: 'application/json',
            sha256: 'preview-1',
            size: 256,
          },
        },
      ],
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.artifactHints).toEqual(
      expect.objectContaining({
        verifyArtifact: expect.objectContaining({ handle: 's8p://artifact/verify-1' }),
        subAgentPatchArtifacts: [
          expect.objectContaining({ handle: 's8p://artifact/subagent-patch-1' }),
        ],
        recentReadArtifacts: [
          expect.objectContaining({
            path: 'src/recent.ts',
            artifact: expect.objectContaining({ handle: 's8p://artifact/recent-read-1' }),
          }),
        ],
        toolResultPreviewArtifacts: [
          expect.objectContaining({
            label: 'Tool result preview: web.search',
            artifact: expect.objectContaining({ handle: 's8p://artifact/preview-1' }),
          }),
        ],
      }),
    );
  });

  it('propagates contextHash from context context to loop result', () => {
    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: true,
      attempts: 1,
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [],
      retryExhausted: false,
      lastContext: {
        context: {
          contextHash: 'ctx-hash-1',
        },
      } as any,
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.contextHash).toBe('ctx-hash-1');
  });

  it('propagates inputRequired for awaiting_input results', () => {
    const telemetry = createTelemetry();
    const inputRequired = {
      type: 'question',
      reason: 'clarification',
      prompt: 'Pick one',
      questions: [
        {
          question: 'Which option?',
          header: 'Pick',
          options: [
            { label: 'A', description: 'First' },
            { label: 'B', description: 'Second' },
          ],
          multiSelect: false,
        },
      ],
    };

    const report: FlowTransactionReport = {
      success: false,
      attempts: 1,
      flowReport: {
        success: false,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [],
      retryExhausted: false,
      terminalReason: 'Awaiting input',
      terminalReasonCode: 'AWAITING_INPUT',
      terminalInputRequired: inputRequired as any,
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('AWAITING_INPUT');
    expect((result as any).inputRequired).toEqual(inputRequired);
  });

  it('surfaces token usage aggregated from audit trail', () => {
    recordAuditEvent('llm.usage', { promptTokens: 10, completionTokens: 20 });
    recordAuditEvent('llm.usage', { promptTokens: 5, completionTokens: 1 });
    recordAuditEvent('other.event', { promptTokens: 999, completionTokens: 999 });

    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: true,
      attempts: 1,
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [],
      retryExhausted: false,
      lastContext: { diff: 'diff', changedFiles: [] } as any,
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.usage).toEqual({ inputTokens: 15, outputTokens: 21, totalTokens: 36 });
  });

  it('surfaces authorization decisions when explicitly enabled', () => {
    recordAuditEvent('authorization.decision', {
      callId: 'call-1',
      toolName: 'fs.readFile',
      phase: 'PATCH',
      outcome: 'allow_once',
      reason: 'ok',
      source: 'user',
      ttlMs: 123,
      persist: 'repo',
      riskLevel: 'low',
      sideEffects: ['read'],
    });

    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: true,
      attempts: 1,
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [],
      retryExhausted: false,
      lastContext: { diff: 'diff', changedFiles: [] } as any,
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: { eventPayload: { includeAuthorizationDecisions: true } } as any,
      telemetry,
    });

    expect(result.authorizationDecisions).toEqual([
      expect.objectContaining({
        callId: 'call-1',
        toolName: 'fs.readFile',
        phase: 'PATCH',
        outcome: 'allow_once',
        reason: 'ok',
        source: 'user',
        ttlMs: 123,
        persist: 'repo',
        riskLevel: 'low',
        sideEffects: ['read'],
      }),
    ]);
  });

  it('maps retry exhaustion as MAX_RETRIES', () => {
    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: false,
      attempts: 3,
      flowReport: {
        success: false,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [
        { attempt: 3, plan: null, patch: null, error: 'verify failed', contextSummary: '' },
      ],
      retryExhausted: true,
      lastErrorCode: 'LLM_RATE_LIMITED',
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('MAX_RETRIES');
    expect(result.terminalReason).toBe('RETRY_BUDGET_EXHAUSTED');
    expect(result.rootCause).toBe('LLM_RATE_LIMITED');
    expect(result.failurePhase).toBe('VERIFY');
  });

  it('propagates diagnostic contract from terminal transaction failure', () => {
    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: false,
      attempts: 1,
      flowReport: {
        success: false,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [{ attempt: 1, plan: null, patch: null, error: 'old', contextSummary: '' }],
      retryExhausted: false,
      terminalReason: 'old',
      terminalReasonCode: 'VERIFY_FAILED',
      terminalFailurePhase: 'VERIFY',
      terminalDiagnosticCode: 'UNDECLARED_DEPENDENCY',
      terminalSafeHint: "Missing declared dependency 'fast-xml-parser'.",
      terminalRemediationSteps: ['Run bun add fast-xml-parser and retry.'],
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.reason).toBe("Missing declared dependency 'fast-xml-parser'.");
    expect(result.safeHint).toBe("Missing declared dependency 'fast-xml-parser'.");
    expect(result.diagnosticCode).toBe('UNDECLARED_DEPENDENCY');
    expect(result.remediationSteps).toEqual(['Run bun add fast-xml-parser and retry.']);
  });

  it('builds an error envelope for terminal failures', () => {
    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: false,
      attempts: 1,
      flowReport: {
        success: false,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [{ attempt: 1, plan: null, patch: null, error: 'old', contextSummary: '' }],
      retryExhausted: false,
      lastErrorCode: 'LLM_HTTP_REQUEST_FAILED',
      terminalReason: 'old',
      terminalReasonCode: 'LOOP_FAILED',
      terminalFailurePhase: 'EXPLORE',
      terminalSafeHint: 'LLM request failed. Please retry in a moment.',
      terminalRemediationSteps: ['Retry the command after a short delay.'],
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.errorEnvelope?.code).toBe('LLM_HTTP_REQUEST_FAILED');
    expect(result.errorEnvelope?.safeMessage).toBe(text.llmErrors.httpRequestFailed);
    expect(result.errorEnvelope?.safeHint).toBe('LLM request failed. Please retry in a moment.');
  });

  it('includes budget summary when budget metrics exist', () => {
    const adjuster = getGlobalAdjuster();
    adjuster.recordMetrics({
      budgetAllocated: 30000,
      tokensUsed: 25000,
      wasTruncated: true,
      criticalContentDropped: false,
      verifySuccess: false,
      iteration: 1,
    });
    adjuster.recordMetrics({
      budgetAllocated: 30000,
      tokensUsed: 15000,
      wasTruncated: false,
      criticalContentDropped: false,
      verifySuccess: true,
      iteration: 2,
    });
    recordBudgetAlert();

    const telemetry = createTelemetry();
    const report: FlowTransactionReport = {
      success: true,
      attempts: 2,
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
        strategyName: 'patch',
        fsMode: 'patch',
      },
      history: [],
      retryExhausted: false,
      lastContext: { diff: 'diff', changedFiles: [] } as any,
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.budgetSummary).toEqual(
      expect.objectContaining({
        attemptCount: 2,
        alertCount: 1,
      }),
    );
  });

  it('maps generic crash via failure result builder', () => {
    const telemetry = createTelemetry();
    const result = buildLoopFailureResult({
      message: 'unexpected',
      flowMode: 'debug',
      telemetry,
      reasonCode: 'LOOP_CRASH',
      failurePhase: 'VERIFY',
    });

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('LOOP_CRASH');
    expect(result.failurePhase).toBe('VERIFY');
    expect(result.strategyName).toBe('debug');
  });
});
