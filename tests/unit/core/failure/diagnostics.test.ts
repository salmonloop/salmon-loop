import { describe, expect, it } from 'bun:test';

import { buildFailureGuidance } from '../../../../src/core/failure/diagnostics.js';

describe('buildFailureGuidance', () => {
  it('returns undeclared dependency guidance for TS2307 missing module in strict mode', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'VERIFY_FAILED',
      failurePhase: 'VERIFY',
      errorCode: 'dependency_error',
      verifyOutput:
        "src/core/context/formatters/json-converter.ts(6,27): error TS2307: Cannot find module 'fast-xml-parser' or its corresponding type declarations.",
      environmentMode: 'strict',
      fallbackReason: 'verification failed',
    });

    expect(guidance.diagnosticCode).toBe('UNDECLARED_DEPENDENCY');
    expect(guidance.safeHint).toContain('fast-xml-parser');
    expect(guidance.remediationSteps[0]).toContain('bun add fast-xml-parser');
    expect(guidance.remediationSteps.join('\n')).toContain('strict mode');
  });
});
