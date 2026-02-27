import { describe, expect, it } from 'bun:test';

import { createDefaultPermissionGate } from '../../../../src/core/permission-gate/default-gate.js';

describe('DefaultPermissionGate', () => {
  it('denies outside-root cache action by default', async () => {
    const gate = createDefaultPermissionGate();
    const decision = await gate.requestAuthorization({
      action: 'context.cache.outside_root',
      resource: '/tmp/cache.json',
      risk: 'high',
    });
    expect(decision.kind).toBe('deny');
  });

  it('allows outside-root cache action when CLI override is enabled', async () => {
    const gate = createDefaultPermissionGate({ allowOutsideCacheRoot: true });
    const decision = await gate.requestAuthorization({
      action: 'context.cache.outside_root',
      resource: '/tmp/cache.json',
      risk: 'high',
    });
    expect(decision.kind).toBe('allow');
    expect(decision.source).toBe('cli');
  });

  it('supports deferred interface by returning immediate decision', async () => {
    const gate = createDefaultPermissionGate();
    const deferred = await gate.requestAuthorizationDeferred?.({
      action: 'context.cache.outside_root',
      resource: '/tmp/cache.json',
      risk: 'high',
    });
    expect(deferred?.kind).toBe('decision');
  });
});
