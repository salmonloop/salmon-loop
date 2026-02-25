import { beforeEach, describe, expect, it, mock } from 'bun:test';

const { readFileMock, writeFileMock, renameMock, mkdirMock, warnMock } = (() => ({
  readFileMock: mock(),
  writeFileMock: mock(),
  renameMock: mock(),
  mkdirMock: mock(),
  warnMock: mock(),
}))();

mock.module('fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
  rename: renameMock,
  mkdir: mkdirMock,
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
  beforeEach(() => {
    clearAuditTrail();
    readFileMock.mockReset();
    writeFileMock.mockReset();
    renameMock.mockReset();
    mkdirMock.mockReset();
    warnMock.mockReset();
  });

  it('appends new audit events to an existing audit file', async () => {
    recordAuditEvent('test.action.one', { a: 1 }, { source: 'test' });
    const existingTrail = getAuditTrail();

    readFileMock.mockResolvedValue(
      JSON.stringify({
        context: {
          auditTrail: existingTrail,
        },
      }),
    );

    recordAuditEvent('test.action.two', { b: 2 }, { source: 'test' });

    await appendAuditTrailToAuditFile('/tmp/audit.json');

    expect(writeFileMock).toHaveBeenCalledTimes(1);
    const written = JSON.parse(writeFileMock.mock.calls[0]![1]) as any;
    expect(written.context.auditTrail).toHaveLength(2);
    expect(written.context.auditTrail[0].action).toBe('test.action.one');
    expect(written.context.auditTrail[1].action).toBe('test.action.two');
  });

  it('does not throw when the audit file cannot be read', async () => {
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    await expect(appendAuditTrailToAuditFile('/tmp/missing.json')).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(writeFileMock).not.toHaveBeenCalled();
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
    expect(writeFileMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledTimes(1);
  });
});
