import { describe, expect, it } from 'bun:test';

import { resolveAttemptFailure } from '../../../../../../src/core/grizzco/engine/transaction/attempt-failure.js';

describe('resolveAttemptFailure diagnostics', () => {
  it('returns actionable dependency guidance when verify fails with missing module', () => {
    const failure = resolveAttemptFailure({
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
      } as any,
      context: {
        options: { environmentMode: 'strict' },
        verifyResult: {
          ok: false,
          output:
            "src/core/context/formatters/json-converter.ts(6,27): error TS2307: Cannot find module 'fast-xml-parser' or its corresponding type declarations.",
          exitCode: 2,
        },
      } as any,
      flowMode: 'patch',
    });

    expect(failure).toBeTruthy();
    expect(failure?.reasonCode).toBe('VERIFY_FAILED');
    expect(failure?.diagnosticCode).toBe('UNDECLARED_DEPENDENCY');
    expect(failure?.safeHint).toContain('fast-xml-parser');
    expect(failure?.remediationSteps[0]).toContain('bun add fast-xml-parser');
    expect(failure?.reason).toBe(failure?.safeHint);
  });

  it('maps ask_user interruptions to awaiting input', () => {
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

    const failure = resolveAttemptFailure({
      flowReport: {
        success: false,
        duration: 1,
        traces: [],
        error: { code: 'ASK_USER_REQUIRED', inputRequired },
      } as any,
      context: {
        options: { environmentMode: 'strict' },
      } as any,
      flowMode: 'patch',
    });

    expect(failure).toBeTruthy();
    expect(failure?.reasonCode).toBe('AWAITING_INPUT');
    expect(failure?.retryable).toBe(false);
    expect((failure as any)?.inputRequired).toEqual(inputRequired);
  });
});
