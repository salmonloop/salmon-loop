import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const { readFileMock, writeFileMock, renameMock, mkdirMock, appendFileMock, warnMock } = (() => ({
  readFileMock: mock(),
  writeFileMock: mock(),
  renameMock: mock(),
  mkdirMock: mock(),
  appendFileMock: mock(),
  warnMock: mock(),
}))();

const getAuditDirMock = mock((repoPath: string, scope?: string) =>
  scope === 'user'
    ? '/home/testuser/.salmonloop/runtime/audit'
    : `${repoPath}/.salmonloop/runtime/audit`,
);

mock.module('../../src/core/adapters/fs/node-fs.js', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  rename: renameMock,
  mkdir: mkdirMock,
  appendFile: appendFileMock,
}));

mock.module('../../src/core/runtime/paths.js', () => ({
  getAuditDir: getAuditDirMock,
}));

mock.module('../../src/core/observability/logger.js', () => ({
  logger: {
    warn: warnMock,
  },
}));

import { appendAuditTrailToAuditFile } from '../../src/core/observability/audit-file.js';
import {
  clearAuditTrail,
  getAuditTrail,
  recordAuditEvent,
} from '../../src/core/observability/audit-trail.js';
import { REDACTED_ERROR_TOKEN } from '../../src/core/observability/error-envelope.js';
import { text } from '../../src/locales/index.js';

describe('appendAuditTrailToAuditFile', () => {
  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    clearAuditTrail();
    readFileMock.mockReset();
    writeFileMock.mockReset();
    renameMock.mockReset();
    mkdirMock.mockReset();
    appendFileMock.mockReset();
    warnMock.mockReset();
    getAuditDirMock.mockClear();
  });

  it('appends new audit events to the events file and updates eventsRef', async () => {
    recordAuditEvent('test.action.one', { a: 1 }, { source: 'test' });
    const existingTrail = getAuditTrail();

    readFileMock.mockResolvedValue(
      JSON.stringify({
        context: {
          eventsRef: {
            path: '/tmp/audit.events.jsonl',
            count: existingTrail.length,
            firstTs: existingTrail[0]?.timestamp,
            lastTs: existingTrail[existingTrail.length - 1]?.timestamp,
          },
        },
      }),
    );

    recordAuditEvent('test.action.two', { b: 2 }, { source: 'test' });

    await appendAuditTrailToAuditFile('/tmp/audit.json');

    expect(appendFileMock).toHaveBeenCalledTimes(1);
    const appended = appendFileMock.mock.calls[0]![1] as string;
    const lines = appended
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(1);
    expect(lines[0].action).toBe('test.action.two');

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeFileMock.mock.calls[0]![1]) as any;
    expect(written.context.eventsRef.count).toBe(2);
    expect(written.context.eventsRef.lastTs).toBe(lines[0].timestamp);
  });

  it('does not throw when the audit file cannot be read', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    await expect(appendAuditTrailToAuditFile('/tmp/missing.json')).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('does not append when eventsRef is missing', async () => {
    recordAuditEvent('test.action.one', { a: 1 }, { source: 'test' });
    readFileMock.mockResolvedValue(JSON.stringify({ context: {} }));

    await expect(appendAuditTrailToAuditFile('/tmp/audit.json')).resolves.toBeUndefined();
    expect(appendFileMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it('creates a fallback audit file when auditPath is missing', async () => {
    recordAuditEvent('test.action.fallback', { a: 1 }, { source: 'test' });
    renameMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);

    const out = await appendAuditTrailToAuditFile({
      auditPath: undefined,
      repoPath: '/tmp/repo',
      failureReason: 'boom',
      runId: 'run-1',
    });

    expect(out).toBeTruthy();
    expect(writeFileMock).toHaveBeenCalledTimes(2);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });

  it('uses audit scope when creating fallback audit file', async () => {
    recordAuditEvent('test.action.scope', { a: 1 }, { source: 'test' });
    renameMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);

    await appendAuditTrailToAuditFile({
      auditPath: undefined,
      repoPath: '/tmp/repo',
      auditScope: 'user',
      failureReason: 'boom',
      runId: 'run-2',
    });

    expect(getAuditDirMock).toHaveBeenCalledWith('/tmp/repo', 'user');
  });

  it('updates audit meta to final run outcome even when no new events are appended', async () => {
    recordAuditEvent('test.action.one', { a: 1 }, { source: 'test' });
    const existingTrail = getAuditTrail();

    readFileMock.mockResolvedValue(
      JSON.stringify({
        meta: {
          success: true,
          reasonCode: 'OK',
        },
        context: {
          eventsRef: {
            path: '/tmp/audit.events.jsonl',
            count: existingTrail.length,
            firstTs: existingTrail[0]?.timestamp,
            lastTs: existingTrail[existingTrail.length - 1]?.timestamp,
          },
        },
      }),
    );

    await appendAuditTrailToAuditFile({
      auditPath: '/tmp/audit.json',
      finalOutcome: {
        success: false,
        reasonCode: 'VERIFY_FAILED',
        failurePhase: 'VERIFY',
        errorCode: 'dependency_error',
      },
    });

    expect(appendFileMock).not.toHaveBeenCalled();
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeFileMock.mock.calls[0]![1]) as any;
    expect(written.meta.success).toBe(false);
    expect(written.meta.reasonCode).toBe('VERIFY_FAILED');
    expect(written.meta.failurePhase).toBe('VERIFY');
    expect(written.meta.errorCode).toBe('dependency_error');
  });

  it('writes errorCategory and errorSummary to audit meta on fallback', async () => {
    recordAuditEvent('test.action.fallback', { a: 1 }, { source: 'test' });
    renameMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);

    await appendAuditTrailToAuditFile({
      auditPath: undefined,
      repoPath: '/tmp/repo',
      failureReason: REDACTED_ERROR_TOKEN,
      runId: 'run-3',
    });

    const written = JSON.parse(writeFileMock.mock.calls[1]![1]) as any;
    expect(written.meta.errorSummary).toBe(text.errors.technicalDetailsHidden);
    expect(written.meta.errorCategory).toBe('unknown');
  });

  it('does not override primary error summary/category with Langfuse events when appending existing audit file', async () => {
    recordAuditEvent(
      'langfuse.outcome.http_failed',
      { status: 401, statusText: 'Unauthorized' },
      { source: 'observability' },
    );
    readFileMock.mockResolvedValue(
      JSON.stringify({
        meta: {},
        context: {
          eventsRef: {
            path: '/tmp/audit.events.jsonl',
            count: 0,
          },
        },
      }),
    );

    await appendAuditTrailToAuditFile({
      auditPath: '/tmp/audit.json',
      failureReason: REDACTED_ERROR_TOKEN,
      finalOutcome: {
        success: false,
        reasonCode: 'LOOP_FAILED',
      },
    });

    const written = JSON.parse(writeFileMock.mock.calls[0]![1]) as any;
    expect(written.meta.errorCategory).toBe('unknown');
    expect(written.meta.errorSummary).toBe(text.errors.technicalDetailsHidden);
    expect(written.meta.secondaryFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'langfuse.outcome.http_failed',
          category: 'auth',
        }),
      ]),
    );
  });

  it('keeps redacted primary failure and records event-derived secondary failures in fallback audit meta', async () => {
    recordAuditEvent(
      'langfuse.outcome.http_failed',
      { status: 401, statusText: 'Unauthorized' },
      { source: 'observability' },
    );
    renameMock.mockResolvedValue(undefined);
    mkdirMock.mockResolvedValue(undefined);

    await appendAuditTrailToAuditFile({
      auditPath: undefined,
      repoPath: '/tmp/repo',
      failureReason: REDACTED_ERROR_TOKEN,
      runId: 'run-4',
    });

    const written = JSON.parse(writeFileMock.mock.calls[1]![1]) as any;
    expect(written.meta.errorCategory).toBe('unknown');
    expect(written.meta.errorSummary).toBe(text.errors.technicalDetailsHidden);
    expect(written.meta.primaryFailure).toMatchObject({
      category: 'unknown',
      summary: text.errors.technicalDetailsHidden,
      redacted: true,
    });
    expect(written.meta.secondaryFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'langfuse.outcome.http_failed',
          category: 'auth',
        }),
      ]),
    );
  });
});
