import { describe, expect, it } from 'bun:test';

import {
  buildArtifactHintAttachments,
  buildRequestEnvelope,
  materializeRequestEnvelope,
} from '../../../../src/core/llm/request-envelope.js';

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
});
