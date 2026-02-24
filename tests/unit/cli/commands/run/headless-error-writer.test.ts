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
