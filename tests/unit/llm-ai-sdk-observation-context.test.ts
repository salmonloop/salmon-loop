import { describe, expect, it } from 'bun:test';

import { withAuditObservationName } from '../../src/core/llm/ai-sdk/observation-context.js';
import {
  clearAuditContext,
  getAuditContext,
  setAuditContext,
} from '../../src/core/observability/audit-trail.js';

describe('withAuditObservationName', () => {
  it('restores previous observationName after success', async () => {
    clearAuditContext();
    setAuditContext({ observationName: 'PREVIOUS' });

    const result = await withAuditObservationName('PLAN:plan-json', async () => {
      return getAuditContext().observationName;
    });

    expect(result).toBe('PLAN:plan-json');
    expect(getAuditContext().observationName).toBe('PREVIOUS');
  });

  it('restores previous observationName after failure', async () => {
    clearAuditContext();
    setAuditContext({ observationName: 'PATCH:unified-diff' });

    await expect(
      withAuditObservationName('PLAN:plan-json', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(getAuditContext().observationName).toBe('PATCH:unified-diff');
  });

  it('restores undefined observationName when no previous value exists', async () => {
    clearAuditContext();

    await withAuditObservationName('PLAN:plan-json', async () => {
      expect(getAuditContext().observationName).toBe('PLAN:plan-json');
      return undefined;
    });

    expect(getAuditContext().observationName).toBeUndefined();
  });
});
