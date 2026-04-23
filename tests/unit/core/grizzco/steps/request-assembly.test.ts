import { describe, expect, it, mock } from 'bun:test';

import type { ContextResult } from '../../../../../src/core/context/types.js';
import {
  buildAugmentedRequestEnvelope,
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
  it('delegates through the unified augmented request entry', async () => {
    const built = await buildAugmentedRequestEnvelope({
      phase: Phase.PLAN,
      defaultNamespace: 'plan',
      context: {
        ...baseContext,
        instruction: 'improve request assembly retry prompts',
      },
      contextResult: {
        ...baseContextResult,
        prompt:
          'ASSEMBLED_CONTEXT_PROMPT\nAlready surfaced memory path: /repo/docs/summary-sync.md',
      },
      systemPrompt: 'system prompt',
      buildUserPrompt: (contextPrompt) => `USER_PROMPT\n${contextPrompt}`,
      relevantMemory: {
        entries: [
          {
            path: '/repo/docs/retry-contract.md',
            title: 'Retry correction contract',
            summary: 'Structured correction hints for invalid tool arguments and retry loops.',
          },
          {
            path: '/repo/docs/request-assembly.md',
            title: 'Request assembly memory notes',
            summary: 'Inject concise relevant memory blocks into assembled prompts.',
          },
        ],
      },
    });

    expect(built.contextPrompt).toContain('[Relevant memory]');
  });

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

  it('injects selected relevant memory into the phase context prompt without duplicating surfaced entries', async () => {
    const built = await buildPhaseRequestEnvelope({
      phase: Phase.PLAN,
      defaultNamespace: 'plan',
      context: {
        ...baseContext,
        instruction: 'improve request assembly retry prompts',
      },
      contextResult: {
        ...baseContextResult,
        prompt:
          'ASSEMBLED_CONTEXT_PROMPT\nAlready surfaced memory path: /repo/docs/summary-sync.md',
      },
      systemPrompt: 'system prompt',
      buildUserPrompt: (contextPrompt) => `USER_PROMPT\n${contextPrompt}`,
      relevantMemory: {
        entries: [
          {
            path: '/repo/docs/retry-contract.md',
            title: 'Retry correction contract',
            summary: 'Structured correction hints for invalid tool arguments and retry loops.',
          },
          {
            path: '/repo/docs/request-assembly.md',
            title: 'Request assembly memory notes',
            summary: 'Inject concise relevant memory blocks into assembled prompts.',
          },
          {
            path: '/repo/docs/summary-sync.md',
            title: 'Summary sync recovery',
            summary: 'Preserve recovery state across compaction boundaries.',
          },
        ],
      },
    });

    const lastUserMessage = built.baseMessages[built.baseMessages.length - 1];
    expect(lastUserMessage?.content).toContain('[Relevant memory]');
    expect(lastUserMessage?.content).toContain('/repo/docs/request-assembly.md');
    expect(lastUserMessage?.content).toContain(
      'Inject concise relevant memory blocks into assembled prompts.',
    );
    expect(lastUserMessage?.content).toContain('/repo/docs/retry-contract.md');
    expect(lastUserMessage?.content).not.toContain('Summary sync recovery');
    expect(lastUserMessage?.content).not.toContain(
      'Preserve recovery state across compaction boundaries.',
    );
  });

  it('suppresses tool-tagged memory that matches the real visible tool set', async () => {
    const built = await buildAugmentedRequestEnvelope({
      phase: Phase.AUTOPILOT,
      defaultNamespace: 'autopilot',
      context: {
        ...baseContext,
        instruction: 'inspect files and keep the prompt concise',
      },
      contextResult: baseContextResult,
      systemPrompt: 'system prompt',
      buildUserPrompt: (contextPrompt) => `USER_PROMPT\n${contextPrompt}`,
      relevantMemory: {
        entries: [
          {
            path: '/repo/docs/fs-read-guide.md',
            title: 'fs.read tool guide',
            summary: 'Use fs.read to inspect file contents before patching.',
            tags: ['tool:fs.read'],
          },
          {
            path: '/repo/docs/autopilot-discipline.md',
            title: 'Autopilot discipline',
            summary: 'Keep the instruction focused and avoid redundant context.',
          },
        ],
      },
      toolVisibility: {
        toolstack: {
          registry: {
            listAll: () =>
              [
                { name: 'fs.read', allowedPhases: [Phase.AUTOPILOT] },
                { name: 'agent_dispatch', allowedPhases: [Phase.AUTOPILOT] },
              ] as any,
          },
          policy: {
            decide: () => ({ allowed: true }),
          },
        },
        flowMode: 'autopilot',
      },
    });

    const lastUserMessage = built.baseMessages[built.baseMessages.length - 1];
    expect(lastUserMessage?.content).toContain('Autopilot discipline');
    expect(lastUserMessage?.content).not.toContain('fs.read tool guide');
    expect(lastUserMessage?.content).not.toContain('Use fs.read to inspect file contents');
  });

  it('injects future unified relevant-memory entries into the phase context prompt', async () => {
    const built = await buildAugmentedRequestEnvelope({
      phase: Phase.PLAN,
      defaultNamespace: 'plan',
      context: {
        ...baseContext,
        instruction: 'route unified request composition through relevant memory injection',
      },
      contextResult: baseContextResult,
      systemPrompt: 'system prompt',
      buildUserPrompt: (contextPrompt) => `USER_PROMPT\n${contextPrompt}`,
      relevantMemory: {
        entries: [
          {
            path: '/repo/docs/autopilot-memory.md',
            title: 'Autopilot request composition',
            summary: 'Route autopilot requests through unified relevant-memory augmentation.',
          },
        ],
      } as any,
    });

    const lastUserMessage = built.baseMessages[built.baseMessages.length - 1];
    expect(lastUserMessage?.content).toContain('[Relevant memory]');
    expect(lastUserMessage?.content).toContain('/repo/docs/autopilot-memory.md');
    expect(lastUserMessage?.content).toContain(
      'Route autopilot requests through unified relevant-memory augmentation.',
    );
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
