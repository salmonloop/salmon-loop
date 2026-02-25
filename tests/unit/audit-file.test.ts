import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const { readFileMock, writeFileMock, renameMock, mkdirMock, appendFileMock, warnMock } = (() => ({
  readFileMock: mock(),
  writeFileMock: mock(),
  renameMock: mock(),
  mkdirMock: mock(),
  appendFileMock: mock(),
  warnMock: mock(),
}))();

mock.module('../../src/core/adapters/fs/node-fs.js', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  rename: renameMock,
  mkdir: mkdirMock,
  appendFile: appendFileMock,
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
});
