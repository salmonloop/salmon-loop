import { describe, it, expect, mock } from 'bun:test';
import * as fc from 'fast-check';

import { ToolAuditLogger } from '../../../src/core/tools/audit.js';
import { BudgetGuard } from '../../../src/core/tools/budget.js';
import { ToolPolicy } from '../../../src/core/tools/policy.js';
import { ToolRegistry } from '../../../src/core/tools/registry.js';
import { ToolRouter } from '../../../src/core/tools/router.js';
import { ToolSanitizer } from '../../../src/core/tools/sanitize.js';
import type { ToolCallEnvelope } from '../../../src/core/tools/types.js';
import { Phase } from '../../../src/core/types/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRouter(): ToolRouter {
  const registry = { getSpec: mock() } as unknown as ToolRegistry;
  const policy = { decide: mock() } as unknown as ToolPolicy;
  const budget = { runWithGuards: mock() } as unknown as BudgetGuard;
  const audit = {
    onStart: mock(),
    onEnd: mock(),
    onAuthorization: mock(),
  } as unknown as ToolAuditLogger;
  const sanitizer = {
    validateInput: mock(),
    sanitizeOutput: mock(),
  } as unknown as ToolSanitizer;
  return new ToolRouter(registry, policy, budget, audit, sanitizer);
}

function callBuildAuthorizationKey(
  router: ToolRouter,
  envelope: Partial<ToolCallEnvelope>,
  spec: { sideEffects?: string[] },
): string {
  return (router as any).buildAuthorizationKey(envelope, spec);
}

function makeEnvelope(
  toolName: string,
  args: unknown,
  phase: string = Phase.CONTEXT,
): Partial<ToolCallEnvelope> {
  return { toolName, args, phase: phase as any };
}

// ---------------------------------------------------------------------------
// Property 3: Authorization Cache Isolation (High-Risk)
// shell.exec with different args requires re-auth
// **Validates: Requirements 2.1, 2.2**
// ---------------------------------------------------------------------------

describe('Property 3: Authorization Cache Isolation', () => {
  const HIGH_RISK_SPEC = { sideEffects: ['process'] as string[] };

  it('shell.exec with different args produces different cache keys', () => {
    fc.assert(
      fc.property(
        fc.json({ depthSize: 'small', maxDepth: 2 }),
        fc.json({ depthSize: 'small', maxDepth: 2 }),
        (rawArgs1, rawArgs2) => {
          // Only test when args are actually different
          fc.pre(rawArgs1 !== rawArgs2);

          const router = createRouter();
          const key1 = callBuildAuthorizationKey(
            router,
            makeEnvelope('shell.exec', JSON.parse(rawArgs1)),
            HIGH_RISK_SPEC,
          );
          const key2 = callBuildAuthorizationKey(
            router,
            makeEnvelope('shell.exec', JSON.parse(rawArgs2)),
            HIGH_RISK_SPEC,
          );

          // Different args must produce different keys for high-risk tools
          expect(key1).not.toBe(key2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('high-risk tools with identical args produce identical cache keys', () => {
    fc.assert(
      fc.property(fc.json({ depthSize: 'small', maxDepth: 2 }), (rawArgs) => {
        const router = createRouter();
        const args = JSON.parse(rawArgs);
        const key1 = callBuildAuthorizationKey(
          router,
          makeEnvelope('shell.exec', args),
          HIGH_RISK_SPEC,
        );
        const key2 = callBuildAuthorizationKey(
          router,
          makeEnvelope('shell.exec', args),
          HIGH_RISK_SPEC,
        );

        expect(key1).toBe(key2);
      }),
      { numRuns: 50 },
    );
  });

  it('different high-risk side effects all include argsHash', () => {
    const effects: string[][] = [['process'], ['fs_write'], ['network'], ['process', 'network']];
    const router = createRouter();

    for (const sideEffects of effects) {
      const key = callBuildAuthorizationKey(
        router,
        makeEnvelope('some.tool', { cmd: 'echo hello' }),
        { sideEffects },
      );
      // Key format: toolName:phase:argsHash (3 segments)
      expect(key.split(':').length).toBe(3);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 4: Authorization Cache Efficiency (Low-Risk)
// fs_read with different args hits cache (same key)
// **Validates: Requirements 2.3**
// ---------------------------------------------------------------------------

describe('Property 4: Authorization Cache Efficiency', () => {
  const LOW_RISK_SPEC = { sideEffects: ['fs_read'] as string[] };

  it('low-risk tool with different args produces the same cache key', () => {
    fc.assert(
      fc.property(
        fc.json({ depthSize: 'small', maxDepth: 2 }),
        fc.json({ depthSize: 'small', maxDepth: 2 }),
        (rawArgs1, rawArgs2) => {
          const router = createRouter();
          const key1 = callBuildAuthorizationKey(
            router,
            makeEnvelope('fs.read', JSON.parse(rawArgs1)),
            LOW_RISK_SPEC,
          );
          const key2 = callBuildAuthorizationKey(
            router,
            makeEnvelope('fs.read', JSON.parse(rawArgs2)),
            LOW_RISK_SPEC,
          );

          // Same key regardless of args for low-risk tools
          expect(key1).toBe(key2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('low-risk key format is toolName:phase only (no argsHash)', () => {
    const router = createRouter();
    const key = callBuildAuthorizationKey(
      router,
      makeEnvelope('fs.read', { path: '/some/file.txt' }),
      LOW_RISK_SPEC,
    );
    // Key format: toolName:phase (2 segments)
    expect(key.split(':').length).toBe(2);
    expect(key).toBe(`fs.read:${Phase.CONTEXT}`);
  });

  it('empty sideEffects array is treated as low-risk', () => {
    fc.assert(
      fc.property(
        fc.json({ depthSize: 'small', maxDepth: 2 }),
        fc.json({ depthSize: 'small', maxDepth: 2 }),
        (rawArgs1, rawArgs2) => {
          const router = createRouter();
          const key1 = callBuildAuthorizationKey(
            router,
            makeEnvelope('code.search', JSON.parse(rawArgs1)),
            { sideEffects: [] },
          );
          const key2 = callBuildAuthorizationKey(
            router,
            makeEnvelope('code.search', JSON.parse(rawArgs2)),
            { sideEffects: [] },
          );

          expect(key1).toBe(key2);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Unit test: Cache invalidation on format change
// **Validates: Requirements 2.5, 10.1**
// ---------------------------------------------------------------------------

describe('Cache invalidation on format change', () => {
  it('key changes when spec transitions from low-risk to high-risk', () => {
    const router = createRouter();
    const args = { command: 'ls -la' };

    const lowRiskKey = callBuildAuthorizationKey(router, makeEnvelope('my.tool', args), {
      sideEffects: ['fs_read'],
    });

    const highRiskKey = callBuildAuthorizationKey(router, makeEnvelope('my.tool', args), {
      sideEffects: ['process'],
    });

    // The keys must differ: low-risk has no argsHash, high-risk does
    expect(lowRiskKey).not.toBe(highRiskKey);
    // Low-risk: toolName:phase
    expect(lowRiskKey.split(':').length).toBe(2);
    // High-risk: toolName:phase:argsHash
    expect(highRiskKey.split(':').length).toBe(3);
    // High-risk key starts with the low-risk key prefix
    expect(highRiskKey.startsWith(lowRiskKey)).toBe(true);
  });

  it('old low-risk cache entry does not match new high-risk key', () => {
    const router = createRouter();
    const args = { command: 'rm -rf /tmp/test' };

    // Simulate: tool was previously low-risk, cached under toolName:phase
    const oldKey = callBuildAuthorizationKey(router, makeEnvelope('my.tool', args), {
      sideEffects: ['fs_read'],
    });

    // Now the spec changes to high-risk — key includes argsHash
    const newKey = callBuildAuthorizationKey(router, makeEnvelope('my.tool', args), {
      sideEffects: ['fs_write'],
    });

    // Old cached entry (oldKey) will NOT match the new lookup (newKey)
    // This effectively invalidates the cache for this tool
    expect(oldKey).not.toBe(newKey);
  });

  it('phase change produces different cache keys', () => {
    const router = createRouter();
    const args = { path: 'file.txt' };
    const spec = { sideEffects: ['fs_read'] as string[] };

    const contextKey = callBuildAuthorizationKey(
      router,
      makeEnvelope('fs.read', args, Phase.CONTEXT),
      spec,
    );
    const patchKey = callBuildAuthorizationKey(
      router,
      makeEnvelope('fs.read', args, Phase.PATCH),
      spec,
    );

    expect(contextKey).not.toBe(patchKey);
  });
});
