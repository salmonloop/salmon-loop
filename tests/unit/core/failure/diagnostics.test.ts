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

  it('maps LLM request failures to a friendly hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'EXPLORE',
      errorCode: 'LLM_HTTP_REQUEST_FAILED',
      fallbackReason:
        'Technical details were hidden for safety. See the audit log for more information.',
    });

    expect(guidance.safeHint).toBe('LLM request failed. Please retry in a moment.');
    expect(guidance.remediationSteps).toContain('Retry the command after a short delay.');
  });

  it('maps LLM aborted requests to a friendly hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'EXPLORE',
      errorCode: 'LLM_HTTP_ABORTED',
      fallbackReason:
        'Technical details were hidden for safety. See the audit log for more information.',
    });

    expect(guidance.safeHint).toBe('LLM request was aborted. Please retry.');
    expect(guidance.remediationSteps).toContain('Retry the command.');
  });

  it('maps exploration no-files-read to a clear action hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'EXPLORE',
      errorCode: 'noFilesRead',
      fallbackReason: 'No files were read during the exploration phase.',
    });

    expect(guidance.safeHint).toBe(
      'Exploration did not read any files. Your instruction may be too vague (for example, "review my code"). Please specify the exact file(s) or scope you want to work with.',
    );
    expect(guidance.remediationSteps).toContain(
      'Explicitly open the target file(s) in your editor, or reference them in your instruction (for example: "review src/main.ts").',
    );
  });

  it('maps patch not applicable to a friendly hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'VALIDATE',
      errorCode: 'PATCH_NOT_APPLICABLE',
      fallbackReason: 'Patch did not apply cleanly.',
    });

    expect(guidance.safeHint).toBe('Patch could not be applied cleanly. Please retry.');
    expect(guidance.remediationSteps).toContain(
      'Re-run after syncing with the latest file contents.',
    );
  });

  it('maps empty patch output to a friendly hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'PATCH',
      errorCode: 'LLM_PATCH_EMPTY',
      fallbackReason: 'LLM returned an empty patch',
    });

    expect(guidance.safeHint).toBe('LLM returned an empty patch. Please retry.');
    expect(guidance.remediationSteps).toContain('Retry the command.');
  });

  it('maps non-unified diff output to a friendly hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'PATCH',
      errorCode: 'LLM_PATCH_NOT_UNIFIED_DIFF',
      fallbackReason: 'LLM patch is not in unified diff format',
    });

    expect(guidance.safeHint).toBe('LLM returned a patch in an unsupported format. Please retry.');
    expect(guidance.remediationSteps).toContain('Ensure the patch is in unified diff format.');
  });

  it('maps lint failures to a clear action hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'VERIFY_FAILED',
      failurePhase: 'VERIFY',
      errorCode: 'lint',
      fallbackReason: 'Lint failed',
    });

    expect(guidance.safeHint).toBe('Linting failed. Fix lint issues and retry.');
    expect(guidance.remediationSteps).toContain('Run the lint command locally to see details.');
  });

  it('maps test failures to a clear action hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'VERIFY_FAILED',
      failurePhase: 'VERIFY',
      errorCode: 'test',
      fallbackReason: 'Tests failed',
    });

    expect(guidance.safeHint).toBe('Tests failed. Fix test failures and retry.');
    expect(guidance.remediationSteps).toContain('Run the test command locally to see details.');
  });

  it('maps generic Error code to a friendly hint', () => {
    const guidance = buildFailureGuidance({
      reasonCode: 'LOOP_FAILED',
      failurePhase: 'EXPLORE',
      errorCode: 'Error',
      fallbackReason:
        'Technical details were hidden for safety. See the audit log for more information.',
    });

    expect(guidance.safeHint).toBe(
      'An unexpected error occurred. Check the audit log for details and retry.',
    );
    expect(guidance.remediationSteps).toContain(
      'Retry the command; if it persists, inspect the audit log for specifics.',
    );
  });
});
