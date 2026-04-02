import { describe, expect, it } from 'bun:test';

import {
  buildArtifactHintAttachments,
  buildRequestEnvelope,
  materializeRequestEnvelope,
} from '../../../../src/core/llm/request-envelope.js';

function parseOpenAICacheHint(hint: string): { namespace: string; components: string[] } {
  const raw = hint.startsWith('cache:') ? hint.slice('cache:'.length) : hint;
  return JSON.parse(raw) as { namespace: string; components: string[] };
}

describe('request-envelope', () => {
  it('renders artifact handles into the final user message for artifact-first retries', () => {
    const envelope = buildRequestEnvelope({
      system: 'system',
      user: 'base prompt',
      attachments: [
        {
          key: 'previous-verify-output',
          kind: 'artifact',
          label: 'Previous verify output',
          content: '',
          artifactHandle: 's8p://artifact/verify-log-123',
          mimeType: 'text/plain',
          size: 321,
        },
      ],
    });

    const messages = materializeRequestEnvelope(envelope);

    expect(messages).toEqual([
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: expect.stringContaining('s8p://artifact/verify-log-123'),
      },
    ]);
    expect(messages[1]?.content).toContain('artifact.read');
    expect(messages[1]?.content).toContain('Previous verify output');
  });

  it('renders tool result preview artifacts as available artifacts', () => {
    const attachments = buildArtifactHintAttachments({
      toolResultPreviewArtifacts: [
        {
          label: 'Tool result preview: web.search output',
          artifact: {
            handle: 's8p://artifact/tool-preview-123',
            mimeType: 'application/json',
            sha256: 'preview',
            size: 1600,
          },
        },
      ],
    });
    const envelope = buildRequestEnvelope({
      system: 'system',
      user: 'base prompt',
      attachments,
    });

    const messages = materializeRequestEnvelope(envelope);
    expect(messages[1]?.content).toContain('Tool result preview: web.search output');
    expect(messages[1]?.content).toContain('s8p://artifact/tool-preview-123');
    expect(messages[1]?.content).toContain('artifact.read');
  });

  it('records cache-safe and late-injection fingerprints and emits cache policy hints', () => {
    const envelope = buildRequestEnvelope({
      system: 'S'.repeat(5000),
      user: 'current user prompt',
      conversationContext: [{ role: 'user', content: 'previous user question' }],
      attachments: [
        {
          key: 'context-prompt',
          kind: 'context',
          content: 'stable context section',
          cacheSafe: true,
        },
        {
          key: 'plan-json',
          kind: 'plan',
          content: '{"goal":"dynamic"}',
        },
      ],
      cacheSafeSurface: {
        contextHash: 'ctx-hash-123',
        namespace: 'plan',
      },
    });

    expect(envelope.cacheSafeSurface.mode).toBe('cache_safe_only');
    expect(envelope.cacheSafeSurface.cacheEligibility).toBe('eligible');
    expect(envelope.cacheSafeSurface.cacheSafeFingerprint).toHaveLength(64);
    expect(envelope.cacheSafeSurface.lateInjectionFingerprint).toHaveLength(64);
    expect(envelope.providerHints.openAICachePolicy).toBeTruthy();
    expect(envelope.providerHints.openAICacheHint).toBeTruthy();

    const parsed = parseOpenAICacheHint(envelope.providerHints.openAICacheHint!);
    expect(parsed.namespace).toBe('plan');
    expect(parsed.components).toContain('ctx-hash-123');
    expect(parsed.components).toContain(`stable:${envelope.cacheSafeSurface.cacheSafeFingerprint}`);
    expect(parsed.components.some((entry) => entry.startsWith('late:'))).toBe(false);
  });

  it('includes late-injection fingerprint in strict_full_prompt mode cache keys', () => {
    const envelope = buildRequestEnvelope({
      system: 'S'.repeat(5000),
      user: 'current user prompt',
      conversationContext: [{ role: 'assistant', content: 'previous assistant answer' }],
      attachments: [
        {
          key: 'context-prompt',
          kind: 'context',
          content: 'stable context section',
          cacheSafe: true,
        },
      ],
      cacheSafeSurface: {
        contextHash: 'ctx-hash-456',
        namespace: 'patch',
        mode: 'strict_full_prompt',
      },
    });

    expect(envelope.cacheSafeSurface.mode).toBe('strict_full_prompt');
    expect(envelope.cacheSafeSurface.cacheEligibility).toBe('eligible');
    expect(envelope.cacheSafeSurface.lateInjectionFingerprint).toHaveLength(64);
    const parsed = parseOpenAICacheHint(envelope.providerHints.openAICacheHint!);
    expect(parsed.components).toContain(
      `late:${envelope.cacheSafeSurface.lateInjectionFingerprint}`,
    );
  });
});
