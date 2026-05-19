import { describe, expect, it } from 'bun:test';

import { buildRunAssistantMessage } from '../../../../../src/cli/commands/run/assistant-message.js';
import type { LoopResult } from '../../../../../src/core/types/loop.js';

function successfulResult(overrides: Partial<LoopResult> = {}): LoopResult {
  return {
    success: true,
    reason: 'Operation completed successfully',
    reasonCode: 'SUCCESS',
    attempts: 1,
    logs: [],
    ...overrides,
  };
}

describe('buildRunAssistantMessage', () => {
  it('uses a read-only answer as the final run message even when no files changed', () => {
    const message = buildRunAssistantMessage({
      mode: 'answer',
      result: successfulResult({
        assistantMessage: 'isEnterprise uses seats >= 50.',
        changedFiles: [],
      }),
    });

    expect(message).toBe('isEnterprise uses seats >= 50.');
  });

  it('falls back to the no-change run message when no assistant answer is available', () => {
    const message = buildRunAssistantMessage({
      mode: 'answer',
      result: successfulResult({ changedFiles: [] }),
    });

    expect(message).toBe('Completed successfully. No files were changed.');
  });

  it('keeps writable run modes focused on changed files even when a summary is available', () => {
    const message = buildRunAssistantMessage({
      mode: 'autopilot',
      result: successfulResult({
        assistantMessage: 'implemented the requested change',
        changedFiles: ['src/example.ts'],
      }),
    });

    expect(message).toContain('src/example.ts');
    expect(message).not.toContain('implemented the requested change');
  });
});
