import { LoopTelemetry } from '../../../../../../src/core/grizzco/engine/observability/loop-telemetry.js';
import {
  buildLoopFailureResult,
  buildLoopResultFromTransaction,
} from '../../../../../../src/core/grizzco/engine/outcome/loop-result-mapper.js';
import type { FlowTransactionReport } from '../../../../../../src/core/grizzco/engine/transaction/types.js';

function createTelemetry() {
  return new LoopTelemetry(() => new Date('2026-02-13T00:00:00.000Z'));
}

describe('loop-result-mapper', () => {
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
    };

    const result = buildLoopResultFromTransaction({
      executionReport: report,
      flowMode: 'patch',
      options: {} as any,
      telemetry,
    });

    expect(result.success).toBe(false);
    expect(result.reasonCode).toBe('MAX_RETRIES');
    expect(result.failurePhase).toBe('VERIFY');
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
