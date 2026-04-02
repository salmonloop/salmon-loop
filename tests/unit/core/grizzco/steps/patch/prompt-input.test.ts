import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { buildPatchPromptInput } from '../../../../../../src/core/grizzco/steps/patch/prompt-input.js';
import {
  clearPromptRegistry,
  createPromptRegistry,
  setPromptRegistry,
} from '../../../../../../src/core/prompts/registry.js';
import { Phase } from '../../../../../../src/core/types/runtime.js';

describe('patch/prompt-input', () => {
  beforeEach(() => {
    setPromptRegistry(createPromptRegistry());
  });

  afterEach(() => {
    clearPromptRegistry();
  });

  it('builds patch request envelope with plan attachment and cache-sharing fallback', async () => {
    const onMismatch = mock();

    const out = await buildPatchPromptInput({
      context: {
        primaryFile: 'src/index.ts',
        primaryText: 'export const value = 1;',
        contextHash: 'local-hash',
      } as any,
      contextResult: {
        prompt: 'ASSEMBLED_CONTEXT',
        meta: {
          contextHash: 'local-hash',
        },
      } as any,
      plan: {
        goal: 'test-goal',
        files: ['src/index.ts'],
        changes: ['Update value'],
        verify: 'bun test',
      },
      planRuntime: {
        sessionId: 'session-1',
        planPathHint: '.salmonloop/plans/session-1.md',
      },
      conversationContext: [{ role: 'user', content: 'hello' }],
      cacheSharing: {
        namespace: 'shared-patch',
        contextHash: 'shared-hash',
      },
      artifactHints: {
        verifyArtifact: {
          handle: 's8p://artifact/verify-1',
          mimeType: 'text/plain',
          sha256: 'verify',
          size: 100,
        },
      },
      toolCallingAudit: [],
      promptVisibleTools: [],
      onCacheMismatch: onMismatch,
      phase: Phase.PATCH,
    });

    expect(out.cacheSurface).toEqual({
      namespace: 'patch',
      contextHash: 'local-hash',
    });
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(out.planStr).toContain('"goal": "test-goal"');
    expect(out.envelope.attachments.some((item) => item.key === 'plan-json')).toBe(true);
    expect(out.baseMessages[0]?.role).toBe('system');
    expect(out.baseMessages[out.baseMessages.length - 1]?.role).toBe('user');
  });
});
