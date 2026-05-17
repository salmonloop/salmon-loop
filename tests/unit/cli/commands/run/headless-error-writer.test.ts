import { describe, expect, it } from 'bun:test';

import { createHeadlessErrorWriter } from '../../../../../src/cli/commands/run/headless-error-writer.js';

function createCollectingWriter() {
  const lines: unknown[] = [];
  return {
    lines,
    writer: {
      writeJsonLine(value: unknown) {
        lines.push(value);
      },
    },
  };
}

describe('createHeadlessErrorWriter (openai profile)', () => {
  it('writes audit_path in json unexpected errors when provided', () => {
    const { lines, writer } = createCollectingWriter();
    const errorWriter = createHeadlessErrorWriter({
      repoPath: '/repo',
      outputFormat: 'json',
      outputProfileForStreamJson: 'native',
      writer: writer as any,
      getSessionId: () => 'sess-json',
      getResumeSessionId: () => undefined,
    });

    errorWriter.writeUnexpectedError({
      message: 'Boom',
      instruction: 'hello',
      auditPath: '/tmp/audit.json',
    } as any);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      session_id: 'sess-json',
      metadata: {
        instruction: 'hello',
        audit_path: '/tmp/audit.json',
      },
    });
  });

  it('writes audit_path in native stream-json unexpected errors when provided', () => {
    const { lines, writer } = createCollectingWriter();
    const errorWriter = createHeadlessErrorWriter({
      repoPath: '/repo',
      outputFormat: 'stream-json',
      outputProfileForStreamJson: 'native',
      writer: writer as any,
      getSessionId: () => 'sess-native',
      getResumeSessionId: () => undefined,
    });

    errorWriter.writeUnexpectedError({
      message: 'Boom',
      instruction: 'hello',
      auditPath: '/tmp/audit.json',
    } as any);

    expect(lines).toHaveLength(3);
    expect(lines.map((line: any) => line.event_seq)).toEqual([0, 1, 2]);
    expect(lines.every((line: any) => line.protocol_version === 1)).toBe(true);
    expect(lines[1]).toMatchObject({
      session_id: 'sess-native',
      event: {
        type: 'error',
        audit_path: '/tmp/audit.json',
      },
    });
  });

  it('writes server_error crash envelope for unexpected errors', () => {
    const { lines, writer } = createCollectingWriter();
    const errorWriter = createHeadlessErrorWriter({
      repoPath: '/repo',
      outputFormat: 'stream-json',
      outputProfileForStreamJson: 'openai',
      writer: writer as any,
      getSessionId: () => undefined,
      getResumeSessionId: () => undefined,
    });

    errorWriter.writeUnexpectedError({ message: 'Boom' });

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created', sequence_number: 0 });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress', sequence_number: 1 });
    expect(lines[2]).toMatchObject({ type: 'error', sequence_number: 2, code: 'server_error' });
    expect(lines[3]).toMatchObject({
      type: 'response.failed',
      sequence_number: 3,
      response: { status: 'failed', error: { code: 'server_error' } },
    });
  });

  it('writes usage_error envelope for usage errors', () => {
    const { lines, writer } = createCollectingWriter();
    const errorWriter = createHeadlessErrorWriter({
      repoPath: '/repo',
      outputFormat: 'stream-json',
      outputProfileForStreamJson: 'openai',
      writer: writer as any,
      getSessionId: () => undefined,
      getResumeSessionId: () => undefined,
    });

    errorWriter.writeUsageError({ message: 'Invalid input', exitCode: 1 });

    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'response.created', sequence_number: 0 });
    expect(lines[1]).toMatchObject({ type: 'response.in_progress', sequence_number: 1 });
    expect(lines[2]).toMatchObject({ type: 'error', sequence_number: 2, code: 'usage_error' });
    expect(lines[3]).toMatchObject({
      type: 'response.failed',
      sequence_number: 3,
      response: { status: 'failed', error: { code: 'invalid_prompt' } },
    });
  });
});
