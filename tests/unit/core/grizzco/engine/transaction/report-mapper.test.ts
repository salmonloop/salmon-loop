import {
  mapRetryExhaustedReport,
  mapSuccessReport,
  mapTerminalFailureReport,
} from '../../../../../../src/core/grizzco/engine/transaction/report-mapper.js';

describe('transaction-report-mapper', () => {
  const flowReport = {
    success: true,
    duration: 1,
    traces: [],
  } as any;

  const history = [{ attempt: 1, plan: null, patch: null, contextSummary: 'none' }] as any;

  it('maps success report', () => {
    const report = mapSuccessReport({
      attempt: 1,
      flowReport,
      history,
      authorizationSummary: null,
      lastErrorCode: undefined,
    });

    expect(report.success).toBe(true);
    expect(report.retryExhausted).toBe(false);
    expect(report.attempts).toBe(1);
  });

  it('maps terminal failure report', () => {
    const report = mapTerminalFailureReport({
      attempt: 2,
      flowReport,
      history,
      authorizationSummary: null,
      failure: {
        reason: 'apply back failed',
        reasonCode: 'APPLY_BACK_FAILED',
        failurePhase: 'APPLY_BACK',
        retryable: false,
        diagnosticCode: 'APPLY_BACK_FAILED',
        safeHint: 'Apply back failed safely.',
        remediationSteps: ['Retry after resolving local conflicts.'],
      },
      lastErrorCode: 'APPLY_BACK_FAILED',
    });

    expect(report.success).toBe(false);
    expect(report.retryExhausted).toBe(false);
    expect(report.terminalReasonCode).toBe('APPLY_BACK_FAILED');
    expect(report.terminalDiagnosticCode).toBe('APPLY_BACK_FAILED');
    expect(report.terminalSafeHint).toBe('Apply back failed safely.');
    expect(report.terminalRemediationSteps).toEqual(['Retry after resolving local conflicts.']);
    expect(report.attempts).toBe(2);
  });

  it('maps retry exhausted report', () => {
    const report = mapRetryExhaustedReport({
      attempts: 3,
      flowReport,
      history,
      authorizationSummary: null,
    });

    expect(report.success).toBe(false);
    expect(report.retryExhausted).toBe(true);
    expect(report.attempts).toBe(3);
  });
});
