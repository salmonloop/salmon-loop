import { beforeEach, describe, expect, it } from 'bun:test';

import { ConfigError } from '../../../src/core/config/errors.js';
import { resolveContextCachePath } from '../../../src/core/context/cache/path-resolver.js';
import { clearAuditTrail, getAuditTrail } from '../../../src/core/observability/audit-trail.js';

describe('resolveContextCachePath permission audit', () => {
  beforeEach(() => {
    clearAuditTrail();
  });

  it('records permission decision audit when outside-root path is denied', async () => {
    await expect(
      resolveContextCachePath('/repo', {
        context: {
          cache: {
            mode: 'persistent',
            path: '../outside/context-cache.json',
            allowedRoots: ['.salmonloop/cache'],
          },
        },
      } as any),
    ).rejects.toThrow(/PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT/);

    const events = getAuditTrail().filter((e) => e.action === 'permission.decision');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]?.source).toBe('permission_gate');
  });

  it('denies symlink-escaped canonical path even when lexical path is inside allowed root', async () => {
    const fileAdapter = {
      exists: async (_path: string) => true,
      realpath: async (path: string) =>
        path === '/repo/.salmonloop/cache' ? '/repo/.salmonloop/cache' : '/outside/escaped',
    };

    await expect(
      resolveContextCachePath(
        '/repo',
        {
          context: {
            cache: {
              mode: 'persistent',
              path: '.salmonloop/cache/context-cache.json',
              allowedRoots: ['.salmonloop/cache'],
            },
          },
        } as any,
        { fileAdapter },
      ),
    ).rejects.toThrow(/PERMISSION_DENIED_CONTEXT_CACHE_OUTSIDE_ROOT/);
  });

  it('records requestId and throws permission-required with requestId for deferred auth', async () => {
    let caught: unknown;
    try {
      await resolveContextCachePath(
        '/repo',
        {
          context: {
            cache: {
              mode: 'persistent',
              path: '../outside/context-cache.json',
              allowedRoots: ['.salmonloop/cache'],
            },
          },
        } as any,
        {
          permissionGate: {
            requestAuthorizationDeferred: async () => ({
              kind: 'pending',
              challenge: 'abc123',
              message: 'authorization required',
              requestId: 'req-1',
            }),
            requestAuthorization: async () => ({ kind: 'deny', source: 'policy' }),
          },
        },
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).code).toBe('PERMISSION_REQUIRED_CONTEXT_CACHE_OUTSIDE_ROOT');
    expect((caught as ConfigError).details?.requestId).toBe('req-1');
    const events = getAuditTrail().filter((e) => e.action === 'permission.decision');
    expect((events[0]?.details as any)?.requestId).toBe('req-1');
  });
});
