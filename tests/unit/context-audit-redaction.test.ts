import { beforeEach, describe, expect, it } from 'bun:test';

import { recordContextAuditEvent } from '../../src/core/context/audit.js';
import { clearAuditTrail, getAuditTrail } from '../../src/core/observability/audit-trail.js';
import { setRedactionConfig } from '../../src/core/security/redaction.js';

describe('context audit redaction', () => {
  beforeEach(() => {
    clearAuditTrail();
    setRedactionConfig();
  });

  it('redacts sensitive strings in audit details', () => {
    recordContextAuditEvent('context.test', {
      token: 'sk-1234567890abcdef',
      note: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def',
    });

    const [event] = getAuditTrail();
    const payload = JSON.stringify(event.details);

    expect(payload).not.toContain('sk-1234567890abcdef');
    expect(payload).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(payload).toContain('[REDACTED]');
  });

  it('can disable redaction', () => {
    setRedactionConfig({ enabled: false });
    recordContextAuditEvent('context.test', { token: 'sk-1234567890abcdef' });

    const [event] = getAuditTrail();
    const payload = JSON.stringify(event.details);

    expect(payload).toContain('sk-1234567890abcdef');
  });
});
