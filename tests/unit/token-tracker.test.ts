import { afterAll, describe, expect, it, mock } from 'bun:test';

const { readFileMock, traceMock } = (() => ({
  readFileMock: mock(),
  traceMock: mock(),
}))();

mock.module('fs/promises', () => ({
  readFile: readFileMock,
}));
mock.module('../../src/core/observability/logger.js', () => ({
  logger: {
    trace: traceMock,
  },
}));

async function loadTokenTracker() {
  return await import('../../src/core/session/token-tracker.js');
}

describe('TokenTracker.extractFromResult', () => {
  afterAll(() => {
    mock.restore();
  });

  it('prefers usage from LoopResult when available', async () => {
    const { TokenTracker } = await loadTokenTracker();
    const usage = await TokenTracker.extractFromResult({
      success: true,
      reason: 'ok',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    } as any);

    expect(usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3 });
  });

  it('returns null when eventsRef is missing', async () => {
    const { TokenTracker } = await loadTokenTracker();
    readFileMock.mockResolvedValueOnce(
      JSON.stringify({
        context: {
          other: 'value',
        },
      }),
    );

    const usage = await TokenTracker.extractFromResult({
      success: true,
      reason: 'ok',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      auditPath: '/tmp/audit.json',
    } as any);

    expect(usage).toBeNull();
  });

  it('extracts and sums usage from eventsRef jsonl', async () => {
    const { TokenTracker } = await loadTokenTracker();
    readFileMock
      .mockResolvedValueOnce(
        JSON.stringify({
          context: {
            eventsRef: {
              path: 'audit.events.jsonl',
              count: 3,
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        [
          JSON.stringify({
            action: 'llm.usage',
            details: { promptTokens: 10, completionTokens: 20 },
          }),
          JSON.stringify({
            action: 'llm.usage',
            details: { promptTokens: 5, completionTokens: 1 },
          }),
          JSON.stringify({
            action: 'other.event',
            details: { promptTokens: 999, completionTokens: 999 },
          }),
        ].join('\n') + '\n',
      );

    const usage = await TokenTracker.extractFromResult({
      success: true,
      reason: 'ok',
      reasonCode: 'SUCCESS',
      attempts: 1,
      logs: [],
      auditPath: '/tmp/audit.json',
    } as any);

    expect(usage).toEqual({ inputTokens: 15, outputTokens: 21, totalTokens: 36 });
  });
});
