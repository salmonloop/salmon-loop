import { describe, expect, it } from 'bun:test';

import {
  buildSystemPrefixDigest,
  buildToolSchemaHash,
  validateSharedPrefixConsistency,
} from '../../../src/core/sub-agent/prefix-consistency.js';

describe('sub-agent/prefix-consistency', () => {
  it('accepts matching cache-critical prefix fields', () => {
    const shared = {
      cacheSharing: {
        namespace: 'plan',
        contextHash: 'ctx-1',
        toolSchemaHash: buildToolSchemaHash({ phase: 'PLAN', allowedToolNames: ['fs.read'] }),
        systemPrefixDigest: buildSystemPrefixDigest({
          phase: 'PLAN',
          namespace: 'plan',
          contextHash: 'ctx-1',
        }),
      },
    };

    const result = validateSharedPrefixConsistency({
      requestSnapshot: shared as any,
      runtimeSnapshot: shared as any,
    });
    expect(result.compatible).toBe(true);
  });

  it('hard-denies shared mode when digest fields are missing', () => {
    const result = validateSharedPrefixConsistency({
      requestSnapshot: { cacheSharing: { namespace: 'plan', contextHash: 'ctx-1' } } as any,
      runtimeSnapshot: { cacheSharing: { namespace: 'plan', contextHash: 'ctx-1' } } as any,
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('missing');
  });

  it('detects deliberate mismatch across context hash, tool hash, and prefix digest', () => {
    const result = validateSharedPrefixConsistency({
      requestSnapshot: {
        cacheSharing: {
          namespace: 'plan',
          contextHash: 'ctx-request',
          toolSchemaHash: 'tools-request',
          systemPrefixDigest: 'prefix-request',
        },
      } as any,
      runtimeSnapshot: {
        cacheSharing: {
          namespace: 'plan',
          contextHash: 'ctx-runtime',
          toolSchemaHash: 'tools-runtime',
          systemPrefixDigest: 'prefix-runtime',
        },
      } as any,
    });
    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('cache_critical_prefix_mismatch');
  });
});
