import { describe, expect, it, mock } from 'bun:test';

import type { ContextResult } from '../../../../../src/core/context/types.js';
import {
  buildPhaseRequestEnvelope,
  buildSharedRequestEnvelope,
} from '../../../../../src/core/grizzco/steps/request-assembly.js';
import type { ToolCallingAuditEntry } from '../../../../../src/core/llm/audit.js';
import { SessionReplacementPreviewProvider } from '../../../../../src/core/session/replacement-preview-provider.js';
import type { Context } from '../../../../../src/core/types/context.js';
import { Phase } from '../../../../../src/core/types/runtime.js';

const baseContext: Context = {
  repoPath: '/repo',
  primaryFile: 'src/index.ts',
  primaryText: 'export const value = 1;',
  contextHash: 'local-hash',
  rgSnippets: [],
};

const baseContextResult: ContextResult = {
  context: baseContext,
  prompt: 'ASSEMBLED_CONTEXT_PROMPT',
  meta: {
    usedChars: 0,
    truncated: false,
    diffScope: 'primary',
    includedFiles: [],
    sectionChars: {
      primary: 0,
      relatedFiles: 0,
      rgSnippets: 0,
      diffs: 0,
      total: 0,
    },
    contextHash: 'local-hash',
  },
};

const auditEntry: ToolCallingAuditEntry = {
  timestamp: new Date(0).toISOString(),
  phase: Phase.EXPLORE,
  round: 1,
  callId: 'call-1',
  toolName: 'agent_dispatch',
  rawArgsType: 'object',
  parsedArgsOk: true,
  toolResultStatus: 'ok',
  toolResultPatchArtifact: {
    handle: 's8p://artifact/patch-1',
    mimeType: 'text/x-diff',
    sha256: 'patch',
    size: 222,
  },
};

describe('buildPhaseRequestEnvelope', () => {
  it('builds envelope from assembled context prompt and resolves artifact hints from audit', async () => {
    const onMismatch = mock();

    const built = await buildPhaseRequestEnvelope({
      phase: Phase.PLAN,
      defaultNamespace: 'plan',
      context: baseContext,
      contextResult: baseContextResult,
      cacheSharing: {
        namespace: 'shared-plan',
        contextHash: 'shared-hash',
      },
      systemPrompt: 'system prompt',
      buildUserPrompt: () => 'user prompt',
      artifactHints: {
        verifyArtifact: {
          handle: 's8p://artifact/verify-1',
          mimeType: 'text/plain',
          sha256: 'verify',
          size: 111,
        },
      },
      toolCallingAudit: [auditEntry],
      onCacheMismatch: onMismatch,
    });

    expect(built.contextPrompt).toBe('ASSEMBLED_CONTEXT_PROMPT');
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(built.cacheSurface).toEqual({
      namespace: 'plan',
      contextHash: 'local-hash',
    });

    const lastUserMessage = built.baseMessages[built.baseMessages.length - 1];
    expect(lastUserMessage?.role).toBe('user');
    expect(lastUserMessage?.content).toContain('s8p://artifact/verify-1');
    expect(lastUserMessage?.content).toContain('s8p://artifact/patch-1');
    expect(lastUserMessage?.content).toContain('artifact.read');
  });

  it('supports prefer_shared mismatch policy and carries extra attachments', async () => {
    const built = await buildPhaseRequestEnvelope({
      phase: Phase.PATCH,
      defaultNamespace: 'patch',
      context: baseContext,
      cacheSharing: {
        namespace: 'shared-patch',
        contextHash: 'shared-hash',
      },
      cacheMismatchPolicy: 'prefer_shared',
      systemPrompt: 'system prompt',
      buildUserPrompt: () => 'user prompt',
      extraAttachments: [
        {
          key: 'plan-json',
          kind: 'plan',
          label: 'Plan JSON',
          content: '{"goal":"test"}',
        },
      ],
    });

    expect(built.cacheSurface).toEqual({
      namespace: 'shared-patch',
      contextHash: 'shared-hash',
    });

    expect(
      built.envelope.attachments.some(
        (item) => item.key === 'context-prompt' && item.kind === 'context' && item.cacheSafe,
      ),
    ).toBe(true);
    expect(
      built.envelope.attachments.some(
        (item) => item.key === 'plan-json' && item.kind === 'plan' && item.content.includes('goal'),
      ),
    ).toBe(true);
  });

  it('hydrates preview artifacts from replacement preview provider', async () => {
    const built = await buildPhaseRequestEnvelope({
      phase: Phase.PLAN,
      defaultNamespace: 'plan',
      context: baseContext,
      systemPrompt: 'system prompt',
      buildUserPrompt: () => 'user prompt',
      previewProvider: new SessionReplacementPreviewProvider({
        schemaVersion: 1,
        entries: {
          'tool-1': {
            toolResultId: 'tool-1',
            decision: 'replaced',
            preview: '{"ok":true}',
            frozenAt: 10,
            sourceArtifactHandle: 's8p://artifact/tool-preview-1',
            identityVersion: 'v1',
            hashAlgorithm: 'sha256',
          },
        },
      }),
    });

    const lastUserMessage = built.baseMessages[built.baseMessages.length - 1];
    expect(lastUserMessage?.content).toContain('s8p://artifact/tool-preview-1');
  });
});

describe('buildSharedRequestEnvelope', () => {
  it('builds base messages and cache-safe provider hints without context formatting', () => {
    const built = buildSharedRequestEnvelope({
      defaultNamespace: 'answer',
      contextHash: 'answer-hash',
      systemPrompt: 'system prompt',
      userPrompt: 'user prompt',
      conversationContext: [{ role: 'assistant', content: 'previous answer' }],
    });

    expect(built.cacheSurface).toEqual({
      namespace: 'answer',
      contextHash: 'answer-hash',
    });
    expect(built.baseMessages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(built.baseMessages[1]).toEqual({ role: 'assistant', content: 'previous answer' });
    expect(built.baseMessages[2]).toEqual({ role: 'user', content: 'user prompt' });
    expect(built.envelope.providerHints.openAICachePolicy).toBeTruthy();
  });
});
