import { describe, expect, it } from 'bun:test';

import { createHeadlessErrorWriter } from '../../../src/cli/commands/run/headless-error-writer.js';
import { persistRunSession } from '../../../src/cli/commands/run/persist-session.js';
import type { StdoutWriter } from '../../../src/cli/headless/stdout-writer.js';
import { JsonReporter } from '../../../src/cli/reporters/json.js';

describe('headless JSON contract experiments', () => {
  it('can only produce duplicate JSON when the first result write throws synchronously', () => {
    let out = '';
    let writeCount = 0;

    const writer: StdoutWriter = {
      write: (chunk: string) => {
        out += chunk;
        return true;
      },
      writeLine: (line: string) => {
        out += `${line}\n`;
        return true;
      },
      writeJsonLine: (value: unknown) => {
        const line = `${JSON.stringify(value)}\n`;
        writeCount += 1;
        if (writeCount === 1) {
          out += line;
          throw new Error('simulated stdout failure after first JSON write');
        }
        out += line;
        return true;
      },
    };

    const reporter = new JsonReporter({
      mode: 'run',
      repoPath: '/repo',
      sessionId: 'sess-1',
      writer,
      now: () => new Date('2026-03-21T00:00:00.000Z'),
    });

    reporter.onStart('hello');

    let thrown: unknown;
    try {
      reporter.onFinish({
        success: false,
        reason: 'Exceeded maximum retry attempts',
        reasonCode: 'MAX_RETRIES',
        diagnosticCode: 'LLM_HTTP_REQUEST_FAILED',
        safeHint: 'Exceeded maximum retry attempts',
        remediationSteps: [],
        attempts: 3,
        logs: [],
        changedFiles: [],
        auditPath: '/tmp/audit.json',
        errorCode: 'LLM_HTTP_REQUEST_FAILED',
      } as any);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);

    const errorWriter = createHeadlessErrorWriter({
      repoPath: '/repo',
      outputFormat: 'json',
      outputProfileForStreamJson: 'native',
      writer,
      getSessionId: () => 'sess-1',
      getResumeSessionId: () => undefined,
    });
    errorWriter.writeJsonFailure({
      message: 'Unexpected error: simulated stdout failure after first JSON write',
      instruction: 'hello',
      sessionId: 'sess-1',
    });

    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]) as any;
    const second = JSON.parse(lines[1]) as any;

    expect(first.metadata.audit_path).toBe('/tmp/audit.json');
    expect(second.metadata.audit_path).toBeUndefined();
    expect(second.metadata.reason).toContain('simulated stdout failure');
  });

  it('swallows session persistence errors after the final payload path', async () => {
    const sessionManager = {
      addMessage() {
        throw new Error('session write failed');
      },
    };

    await expect(
      persistRunSession({
        sessionManager: sessionManager as any,
        llm: {} as any,
        instruction: 'hello',
        result: {
          success: false,
          reason: 'Exceeded maximum retry attempts',
          history: [],
          contextHash: 'ctx-1',
        } as any,
        buildAssistantMessage: () => 'assistant',
      }),
    ).resolves.toBeUndefined();
  });
});
