import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';

import { TokenTracker } from '../../src/core/session/token-tracker.js';

describe('TokenTracker.extractFromResult', () => {
  it('prefers usage from LoopResult when available', async () => {
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

  it('extracts and sums usage from audit trail', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'salmon-loop-token-tracker-'));
    try {
      const auditPath = path.join(dir, 'audit.json');
      await writeFile(
        auditPath,
        JSON.stringify({
          context: {
            auditTrail: [
              {
                action: 'llm.usage',
                details: { promptTokens: 10, completionTokens: 20 },
              },
              {
                action: 'llm.usage',
                details: { promptTokens: 5, completionTokens: 1 },
              },
              {
                action: 'other.event',
                details: { promptTokens: 999, completionTokens: 999 },
              },
            ],
          },
        }),
        'utf8',
      );

      const usage = await TokenTracker.extractFromResult({
        success: true,
        reason: 'ok',
        reasonCode: 'SUCCESS',
        attempts: 1,
        logs: [],
        auditPath,
      } as any);

      expect(usage).toEqual({ inputTokens: 15, outputTokens: 21, totalTokens: 36 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
