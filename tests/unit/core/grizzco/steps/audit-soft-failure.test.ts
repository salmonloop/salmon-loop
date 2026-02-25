const { mkdirMock, writeFileMock } = (() => ({
  mkdirMock: mock(),
  writeFileMock: mock(),
}))();

mock.module('../../../../../src/core/adapters/fs/node-fs.js', () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

import * as path from 'path';

import { describe, expect, it, mock } from 'bun:test';

import { Pipeline } from '../../../../../src/core/grizzco/engine/pipeline/pipeline.js';
import { saveAudit } from '../../../../../src/core/grizzco/steps/audit.js';
import { clearAuditTrail } from '../../../../../src/core/observability/audit-trail.js';
import { freezeSystemTime } from '../../../../helpers/time.js';

describe('saveAudit (blob write best-effort)', () => {
  it('still writes bounded audit JSON when blob write fails', async () => {
    useFakeTimers();
    const restoreTime = freezeSystemTime('2026-02-15T00:00:00.000Z');
    try {
      clearAuditTrail();
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockImplementation(async (filePath: any) => {
        const p = String(filePath);
        if (p.includes(`${path.sep}blobs${path.sep}`)) {
          throw new Error('disk full');
        }
        return undefined;
      });

      const report = await Pipeline.of({
        verifyResult: {
          ok: true,
          exitCode: 0,
          output: 'x'.repeat(10_000),
        },
      } as any)
        .step('VERIFY', async (ctx) => ctx)
        .execute();

      const noopLlm = {
        chat: async () => ({ role: 'assistant' as const, content: '' }),
        createPlan: async () => ({ goal: '', files: [], changes: [], verify: '' }),
        createPatch: async () => '',
      };

      const auditPath = await saveAudit(report as any, {
        instruction: 'audit',
        repoPath: process.cwd(),
        llm: noopLlm as any,
      });

      expect(auditPath).toBeTruthy();

      const jsonCall = writeFileMock.mock.calls.find(([p]: any[]) => String(p).endsWith('.json'));
      expect(jsonCall).toBeTruthy();

      const auditJson = JSON.parse(String(jsonCall![1]));
      expect(auditJson.context.verifyResult.outputTruncated).toBe(true);
      expect(auditJson.context.verifyResult.output.length).toBeLessThan(5000);
      expect(auditJson.context.verifyResult.outputBlob).toBeUndefined();
      expect(auditJson.context.eventsRef).toBeTruthy();

      const eventsCall = writeFileMock.mock.calls.find(([p]: any[]) =>
        String(p).endsWith('.events.jsonl'),
      );
      expect(eventsCall).toBeTruthy();
      const events = String(eventsCall![1])
        .trim()
        .split('\n')
        .map((line: string) => JSON.parse(line));
      expect(events.some((e: any) => e.action === 'audit.blob.write.failed')).toBe(true);
    } finally {
      restoreTime();
      useRealTimers();
    }
  });
});
