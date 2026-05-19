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
        error: {
          code: 'INTERRUPT_REQUIRED',
          interrupt: {
            type: 'awaiting_input',
            reason: 'clarification',
            prompt: 'Pick one',
            data: { inputRequired },
          },
        },
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

  it('classifies recoverable tool input failures as correction-needed retryable failures', () => {
    const failure = resolveAttemptFailure({
      flowReport: {
        success: false,
        duration: 1,
        traces: [
          {
            name: 'PATCH',
            error: {
              code: 'INVALID_INPUT',
              message:
                'Invalid input: content is required. Expected JSON object. Keys: file: string, content: string.',
            },
          },
        ],
        error: {
          code: 'INVALID_INPUT',
          message:
            'Invalid input: content is required. Expected JSON object. Keys: file: string, content: string.',
        },
      } as any,
      context: {
        options: { environmentMode: 'strict' },
      } as any,
      flowMode: 'autopilot',
    });

    expect(failure).toBeTruthy();
    expect(failure?.failurePhase).toBe('PATCH');
    expect(failure?.errorCode).toBe('INVALID_INPUT');
    expect(failure?.retryable).toBe(true);
    expect(failure?.reasonCode).not.toBe('LOOP_FAILED');
    expect(failure?.diagnosticCode).not.toBe(failure?.reasonCode);
    expect(failure?.safeHint).toBeTruthy();
    expect(failure?.remediationSteps.length).toBeGreaterThan(0);
  });

  it('does not allow autopilot tool failures with no workspace effect to report success', () => {
    const failure = resolveAttemptFailure({
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
      } as any,
      context: {
        options: { environmentMode: 'strict' },
        mutated: false,
        completion: {
          status: 'tool_failure',
          reason: 'Tool agent_dispatch failed: missing task.',
          errorCode: 'INVALID_INPUT',
        },
        report: {
          kind: 'answer',
          summary: 'I could not continue.',
          timestamp: 1,
        },
      } as any,
      flowMode: 'autopilot',
    });

    expect(failure).toBeTruthy();
    expect(failure?.reasonCode).toBe('TOOL_CORRECTION_REQUIRED');
    expect(failure?.failurePhase).toBe('AUTOPILOT');
    expect(failure?.errorCode).toBe('INVALID_INPUT');
    expect(failure?.retryable).toBe(true);
  });

  it('requires verification when autopilot changed the workspace', () => {
    const failure = resolveAttemptFailure({
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
      } as any,
      context: {
        options: { environmentMode: 'strict' },
        mutated: true,
        changedFiles: ['src/app.ts'],
        completion: {
          status: 'verification_missing',
          reason: 'Autopilot changed the workspace but no verification command was configured.',
          errorCode: 'VERIFY_COMMAND_MISSING',
        },
        report: {
          kind: 'answer',
          summary: 'Changed src/app.ts.',
          timestamp: 1,
        },
      } as any,
      flowMode: 'autopilot',
    });

    expect(failure).toBeTruthy();
    expect(failure?.reasonCode).toBe('VERIFY_COMMAND_MISSING');
    expect(failure?.failurePhase).toBe('VERIFY');
    expect(failure?.retryable).toBe(false);
    expect(failure?.safeHint).toContain('verification command');
  });

  it('reports verification diagnostics when autopilot changed files but verify fails', () => {
    const failure = resolveAttemptFailure({
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
      } as any,
      context: {
        options: { environmentMode: 'strict' },
        mutated: true,
        changedFiles: ['smoke.txt'],
        completion: {
          status: 'changed',
          reason: 'Changed smoke.txt.',
        },
        verifyResult: {
          ok: false,
          output: 'verify failed: expected trailing newline',
          exitCode: 1,
        },
        report: {
          kind: 'answer',
          summary: 'Changed smoke.txt.',
          timestamp: 1,
        },
      } as any,
      flowMode: 'autopilot',
    });

    expect(failure).toBeTruthy();
    expect(failure?.reasonCode).toBe('VERIFY_FAILED');
    expect(failure?.failurePhase).toBe('VERIFY');
    expect(failure?.diagnosticCode).toBe('VERIFY_FAILED');
    expect(failure?.safeHint).not.toBe('Loop execution failed');
    expect(failure?.remediationSteps.length).toBeGreaterThan(0);
  });

  it('allows read-only autopilot answers without forcing sub-agent artifact consumption', () => {
    const failure = resolveAttemptFailure({
      flowReport: {
        success: true,
        duration: 1,
        traces: [],
      } as any,
      context: {
        options: { environmentMode: 'strict' },
        mutated: false,
        completion: { status: 'read_only_answer' },
        toolCallingAudit: [
          {
            toolName: 'agent_dispatch',
            toolResultStatus: 'ok',
            toolResultPatchArtifact: {
              handle: 's8p://artifact/subagent-patch',
              mimeType: 'text/x-diff',
              sha256: 'patch',
              size: 100,
            },
          },
        ],
        report: {
          kind: 'answer',
          summary: 'The requested result is diagnostic only.',
          timestamp: 1,
        },
      } as any,
      flowMode: 'autopilot',
    });

    expect(failure).toBeUndefined();
  });
});
