const { readFileMock, writeFileMock, warnMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  writeFileMock: vi.fn(),
  warnMock: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readFile: readFileMock,
  writeFile: writeFileMock,
}));

vi.mock('../../src/core/logger.js', () => ({
  logger: {
    warn: warnMock,
  },
}));

import { appendAuditTrailToAuditFile } from '../../src/core/audit-file.js';
import { clearAuditTrail, getAuditTrail, recordAuditEvent } from '../../src/core/audit-trail.js';

describe('appendAuditTrailToAuditFile', () => {
  beforeEach(() => {
    clearAuditTrail();
    readFileMock.mockReset();
    writeFileMock.mockReset();
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
});
