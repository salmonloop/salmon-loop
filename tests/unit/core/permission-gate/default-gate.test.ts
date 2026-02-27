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

  it('delegates outside-root decision to authorization provider when configured', async () => {
    const gate = createDefaultPermissionGate({
      repoRoot: '/repo',
      authorizationProvider: {
        requestAuthorization: async () => ({ outcome: 'allow_once', source: 'user' }),
      },
    });
    const decision = await gate.requestAuthorization({
      action: 'context.cache.outside_root',
      resource: '/outside/cache.json',
      risk: 'high',
    });
    expect(decision.kind).toBe('allow');
    expect(decision.source).toBe('user');
  });

  it('returns pending challenge when provider defers authorization', async () => {
    const gate = createDefaultPermissionGate({
      repoRoot: '/repo',
      authorizationProvider: {
        requestAuthorization: async () => ({ outcome: 'deny', source: 'user' }),
        requestAuthorizationDeferred: async () => ({
          kind: 'pending',
          challenge: 'abc123',
          message: 'approval required',
        }),
      },
    });
    const deferred = await gate.requestAuthorizationDeferred?.({
      action: 'context.cache.outside_root',
      resource: '/outside/cache.json',
      risk: 'high',
    });
    expect(deferred).toEqual({
      kind: 'pending',
      challenge: 'abc123',
      message: 'approval required',
      requestId: expect.any(String),
    });
  });

  it('caches allow decision after deferred authorization is approved once', async () => {
    const gate = createDefaultPermissionGate({
      repoRoot: '/repo',
      authorizationProvider: {
        requestAuthorization: async () => ({ outcome: 'deny', source: 'user' }),
        requestAuthorizationDeferred: async () => ({
          kind: 'pending',
          challenge: 'abc123',
          message: 'authorization required',
        }),
        waitForAuthorization: async (_requestId: string) => ({
          outcome: 'allow_once',
          source: 'user',
        }),
      },
    });

    const deferred = await gate.requestAuthorizationDeferred?.({
      action: 'context.cache.outside_root',
      resource: '/outside/cache.json',
      risk: 'high',
    });
    expect(deferred?.kind).toBe('pending');
    const wait = await gate.waitForAuthorization?.((deferred as any).requestId);
    expect(wait?.kind).toBe('allow');

    const decision = await gate.requestAuthorization({
      action: 'context.cache.outside_root',
      resource: '/outside/cache.json',
      risk: 'high',
    });
    expect(decision.kind).toBe('allow');
    expect(decision.source).toBe('cache');
  });
});
