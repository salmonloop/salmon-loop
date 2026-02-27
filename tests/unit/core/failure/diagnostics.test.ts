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

  it('does not classify relative module resolution failures as undeclared package dependencies', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'VERIFY_FAILED',
      failurePhase: 'VERIFY',
      errorCode: 'dependency_error',
      verifyOutput:
        "src/main.ts(1,21): error TS2307: Cannot find module './local-helper' or its corresponding type declarations.",
      environmentMode: 'strict',
      fallbackReason: 'verification failed',
    });

    expect(guidance.diagnosticCode).toBe('VERIFY_DEPENDENCY_ERROR');
    expect(guidance.safeHint).toContain('dependency setup is incomplete');
    expect(guidance.remediationSteps.join('\n')).not.toContain('bun add ./local-helper');
  });

  it('does not emit shell-injectable install commands for invalid module names', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'VERIFY_FAILED',
      failurePhase: 'VERIFY',
      errorCode: 'dependency_error',
      verifyOutput:
        "src/main.ts(1,21): error TS2307: Cannot find module 'left-pad; echo HACKED' or its corresponding type declarations.",
      fallbackReason: 'verification failed',
    });

    expect(guidance.diagnosticCode).toBe('VERIFY_DEPENDENCY_ERROR');
    expect(guidance.remediationSteps.join('\n')).not.toContain('echo HACKED');
    expect(guidance.remediationSteps.join('\n')).not.toContain('bun add left-pad; echo HACKED');
  });
});
