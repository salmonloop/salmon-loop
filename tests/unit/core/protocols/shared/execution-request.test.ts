import { describe, expect, test } from 'bun:test';

import {
  buildCanonicalExecutionRequest,
  buildInstructionFromParts,
  normalizeInstructionText,
} from '../../../../../src/core/protocols/shared/execution-request.js';

describe('canonical execution request', () => {
  test('normalizes instruction text and trims whitespace', () => {
    const normalized = normalizeInstructionText('  Hello\r\nWorld  ');
    expect(normalized).toBe('Hello\nWorld');
  });

  test('uses fallback instruction when normalized text is empty', () => {
    const normalized = normalizeInstructionText(' \n\t ', {
      fallbackInstruction: 'Run task',
    });
    expect(normalized).toBe('Run task');
  });

  test('builds instruction from parts using shared normalization', () => {
    const instruction = buildInstructionFromParts([' First', 'Second '], {
      fallbackInstruction: 'Run task',
    });
    expect(instruction).toBe('First\nSecond');
  });

  test('builds canonical execution request with normalized instruction', () => {
    const request = buildCanonicalExecutionRequest({
      capability: 'patch',
      instruction: '\r\n  Fix bug  \r\n',
      repoPath: '/repo',
      checkpointSessionId: 'session-1',
    });

    expect(request.capability).toBe('patch');
    expect(request.request.instruction).toBe('Fix bug');
    expect(request.request.repoPath).toBe('/repo');
    expect(request.request.checkpointSessionId).toBe('session-1');
  });
});
