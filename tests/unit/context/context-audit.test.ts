import { CONTEXT_AUDIT_ACTION } from '../../../src/core/context/audit-constants.js';
import { recordContextAuditEvent } from '../../../src/core/context/audit.js';
import { clearAuditTrail, getAuditTrail } from '../../../src/core/observability/audit-trail.js';
import { captureAuditEvents, expectAuditAction } from '../../helpers/audit-assert.js';

describe('recordContextAuditEvent', () => {
  beforeEach(() => {
    clearAuditTrail();
  });

  it('sanitizes details to keep audit payload bounded', () => {
    recordContextAuditEvent(
      CONTEXT_AUDIT_ACTION.packSummary,
      {
        bigText: 'x'.repeat(10_000),
        bigArray: Array.from({ length: 500 }, (_, i) => i),
        deep: { a: { b: { c: { d: { e: 'too-deep' } } } } },
      },
      { source: 'context', severity: 'low', scope: 'session', phase: 'TEST' },
    );

    const ev = getAuditTrail().find((e) => e.action === CONTEXT_AUDIT_ACTION.packSummary);
    expect(ev).toBeTruthy();

    const details = ev!.details as any;
    expect(details.bigText.length).toBe(2000);
    expect(details.bigArray.length).toBe(50);
    expect(details.deep.a.b.c).toBe('[Truncated]');
  });

  it('always records audit actions via centralized helper', async () => {
    const payload = {
      detail: 'audit-event',
    };
    const { events } = await captureAuditEvents(() =>
      recordContextAuditEvent(CONTEXT_AUDIT_ACTION.packSummary, payload, {
        source: 'context',
        severity: 'medium',
        phase: 'TEST',
      }),
    );

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((event) => event.action === CONTEXT_AUDIT_ACTION.packSummary)).toBe(true);
  });

  it('throws when expected audit action never runs', async () => {
    await expect(
      expectAuditAction('nonexistent.action', () => {
        recordContextAuditEvent(CONTEXT_AUDIT_ACTION.packSummary, {}, {});
      }),
    ).rejects.toThrow(/nonexistent\.action/);
  });
});
