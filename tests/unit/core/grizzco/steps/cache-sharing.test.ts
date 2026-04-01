import { describe, expect, it, mock } from 'bun:test';

import { resolveCacheSharingSurface } from '../../../../../src/core/grizzco/steps/cache-sharing.js';

describe('resolveCacheSharingSurface', () => {
  it('uses local namespace/context hash when no shared snapshot is provided', () => {
    const surface = resolveCacheSharingSurface({
      phase: 'PLAN',
      defaultNamespace: 'plan',
      localContextHash: 'local-hash',
    });

    expect(surface).toEqual({
      namespace: 'plan',
      contextHash: 'local-hash',
    });
  });

  it('prefers shared cache namespace/context hash when snapshot provides both', () => {
    const surface = resolveCacheSharingSurface({
      phase: 'PATCH',
      defaultNamespace: 'patch',
      localContextHash: 'parent-hash',
      cacheSharing: {
        namespace: 'parent-plan',
        contextHash: 'parent-hash',
      },
    });

    expect(surface).toEqual({
      namespace: 'parent-plan',
      contextHash: 'parent-hash',
    });
  });

  it('falls back to local cache surface when shared and local hashes diverge', () => {
    const onMismatch = mock();

    const surface = resolveCacheSharingSurface({
      phase: 'RESEARCH',
      defaultNamespace: 'research',
      localContextHash: 'local-hash',
      cacheSharing: {
        namespace: 'parent-explore',
        contextHash: 'parent-hash',
      },
      onMismatch,
    });

    expect(surface).toEqual({
      namespace: 'research',
      contextHash: 'local-hash',
    });
    expect(onMismatch).toHaveBeenCalledWith({
      phase: 'RESEARCH',
      localContextHash: 'local-hash',
      sharedContextHash: 'parent-hash',
      namespace: 'parent-explore',
    });
  });

  it('can keep shared cache surface on mismatch when policy prefers shared', () => {
    const surface = resolveCacheSharingSurface({
      phase: 'PATCH',
      defaultNamespace: 'patch',
      localContextHash: 'local-hash',
      cacheSharing: {
        namespace: 'parent-plan',
        contextHash: 'parent-hash',
      },
      mismatchPolicy: 'prefer_shared',
    });

    expect(surface).toEqual({
      namespace: 'parent-plan',
      contextHash: 'parent-hash',
    });
  });
});
