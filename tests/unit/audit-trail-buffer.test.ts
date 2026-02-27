import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import {
  clearAuditTrail,
  getAuditTrail,
  recordAuditEvent,
  setAuditBufferLimits,
} from '../../src/core/observability/audit-trail.js';

describe('audit trail buffer limits', () => {
  beforeEach(() => {
    clearAuditTrail();
    setAuditBufferLimits({ maxEvents: 2, maxBytes: 1000 });
  });

  afterEach(() => {
    setAuditBufferLimits();
  });

  it('drops low-severity events when buffer is full', () => {
    recordAuditEvent('evt.low.1', { a: 1 }, { severity: 'low' });
    recordAuditEvent('evt.high', { a: 2 }, { severity: 'high' });
    recordAuditEvent('evt.low.2', { a: 3 }, { severity: 'low' });

    const events = getAuditTrail();
    const actions = events.map((e) => e.action);

    expect(events.length).toBeLessThanOrEqual(2);
    expect(actions).toContain('evt.high');
  });
});
