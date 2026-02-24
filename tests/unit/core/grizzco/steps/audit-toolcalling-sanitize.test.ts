const { mkdirMock, writeFileMock } = vi.hoisted(() => ({
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  mkdir: mkdirMock,
  writeFile: writeFileMock,
}));

import { describe, expect, it, vi } from 'bun:test';

import { Pipeline } from '../../../../../src/core/grizzco/engine/pipeline/pipeline.js';
import { saveAudit } from '../../../../../src/core/grizzco/steps/audit.js';
import { clearAuditTrail } from '../../../../../src/core/observability/audit-trail.js';

describe('saveAudit (toolCallingAudit args preview sanitization)', () => {
  it('keeps args preview only for INVALID_INPUT entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-17T00:00:00.000Z'));
    try {
      clearAuditTrail();
      mkdirMock.mockResolvedValue(undefined);
      writeFileMock.mockResolvedValue(undefined);

      const report = await Pipeline.of({
        toolCallingAudit: [
          {
            timestamp: new Date().toISOString(),
            phase: 'EXPLORE',
            round: 0,
            callId: 'call_1',
            toolName: 'fs.list',
            rawArgsType: 'string',
            rawArgsPreview: '{"path":"."}',
            parsedArgsOk: true,
            parsedArgsPreview: '{"path":"."}',
          },
          {
            timestamp: new Date().toISOString(),
            phase: 'EXPLORE',
            round: 0,
            callId: 'call_1',
            toolName: 'fs.list',
            rawArgsType: 'string',
            rawArgsPreview: '{"path":"."}',
            parsedArgsOk: true,
            parsedArgsPreview: '{"path":"."}',
            toolResultStatus: 'error',
            toolResultErrorCode: 'INVALID_INPUT',
            toolResultErrorMessage: 'path: Required',
          },
          {
            timestamp: new Date().toISOString(),
            phase: 'EXPLORE',
            round: 0,
            callId: 'call_2',
            toolName: 'fs.read',
            rawArgsType: 'string',
            rawArgsPreview: '{"file":"README.md"}',
            parsedArgsOk: true,
            parsedArgsPreview: '{"file":"README.md"}',
            toolResultStatus: 'error',
            toolResultErrorCode: 'SCHEMA_VIOLATION',
            toolResultErrorMessage: 'Output validation failed',
          },
        ],
      } as any)
        .step('EXPLORE', async (ctx) => ctx)
        .execute();

      const noopLlm = {
        chat: async () => ({ role: 'assistant' as const, content: '' }),
        createPlan: async () => ({ goal: '', files: [], changes: [], verify: '' }),
        createPatch: async () => '',
      };

      await saveAudit(report as any, {
        instruction: 'audit',
        repoPath: process.cwd(),
        llm: noopLlm as any,
      });

      const jsonCall = writeFileMock.mock.calls.find(([p]: any[]) => String(p).endsWith('.json'));
      expect(jsonCall).toBeTruthy();

      const auditJson = JSON.parse(String(jsonCall![1]));
      const entries = auditJson.context.toolCallingAudit;
      expect(Array.isArray(entries)).toBe(true);

      const start = entries.find((e: any) => e.callId === 'call_1' && !e.toolResultErrorCode);
      expect(start.rawArgsPreview).toBeUndefined();
      expect(start.parsedArgsPreview).toBeUndefined();
      expect(start.toolResultErrorMessage).toBeUndefined();

      const invalid = entries.find((e: any) => e.toolResultErrorCode === 'INVALID_INPUT');
      expect(typeof invalid.rawArgsPreview).toBe('string');
      expect(typeof invalid.parsedArgsPreview).toBe('string');
      expect(typeof invalid.toolResultErrorMessage).toBe('string');

      const other = entries.find((e: any) => e.toolResultErrorCode === 'SCHEMA_VIOLATION');
      expect(other.rawArgsPreview).toBeUndefined();
      expect(other.parsedArgsPreview).toBeUndefined();
      expect(other.toolResultErrorMessage).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
