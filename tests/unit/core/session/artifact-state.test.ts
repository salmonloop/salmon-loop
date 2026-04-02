import { describe, expect, it } from 'bun:test';

import {
  buildSessionArtifactStateFromLoopResult,
  mergeSessionArtifactState,
  normalizeSessionArtifactState,
} from '../../../../src/core/session/artifact-state.js';

describe('session/artifact-state', () => {
  it('normalizes and bounds artifact state payloads', () => {
    const normalized = normalizeSessionArtifactState({
      verifyArtifact: {
        handle: 's8p://artifact/verify-1',
        mimeType: 'text/plain',
        sha256: 'verify',
        size: 100,
      },
      subAgentPatchArtifacts: Array.from({ length: 10 }, (_, i) => ({
        handle: `s8p://artifact/patch-${i}`,
        mimeType: 'text/x-diff',
        sha256: `patch-${i}`,
        size: i,
      })),
      recentReadArtifacts: [
        {
          path: 'src/a.ts',
          artifact: {
            handle: 's8p://artifact/read-a',
            mimeType: 'text/plain',
            sha256: 'read-a',
            size: 1,
          },
        },
        {
          path: '',
          artifact: {
            handle: 's8p://artifact/invalid',
            mimeType: 'text/plain',
            sha256: 'invalid',
            size: 1,
          },
        } as any,
      ],
    });

    expect(normalized?.verifyArtifact?.handle).toBe('s8p://artifact/verify-1');
    expect(normalized?.subAgentPatchArtifacts).toHaveLength(4);
    expect(normalized?.recentReadArtifacts).toEqual([
      {
        path: 'src/a.ts',
        artifact: expect.objectContaining({ handle: 's8p://artifact/read-a' }),
      },
    ]);
  });

  it('merges existing and incoming state with de-duplication', () => {
    const merged = mergeSessionArtifactState(
      {
        subAgentPatchArtifacts: [
          {
            handle: 's8p://artifact/patch-1',
            mimeType: 'text/x-diff',
            sha256: 'patch-1',
            size: 10,
          },
        ],
      },
      {
        subAgentPatchArtifacts: [
          {
            handle: 's8p://artifact/patch-1',
            mimeType: 'text/x-diff',
            sha256: 'patch-1',
            size: 10,
          },
          {
            handle: 's8p://artifact/patch-2',
            mimeType: 'text/x-diff',
            sha256: 'patch-2',
            size: 20,
          },
        ],
      },
    );

    expect(merged?.subAgentPatchArtifacts).toEqual([
      expect.objectContaining({ handle: 's8p://artifact/patch-1' }),
      expect.objectContaining({ handle: 's8p://artifact/patch-2' }),
    ]);
  });

  it('builds session artifact state from loop result hints and verify fallback', () => {
    const state = buildSessionArtifactStateFromLoopResult({
      verifyArtifact: {
        handle: 's8p://artifact/verify-from-result',
        mimeType: 'text/plain',
        sha256: 'verify-result',
        size: 120,
      },
      artifactHints: {
        recentReadArtifacts: [
          {
            path: 'src/recent.ts',
            artifact: {
              handle: 's8p://artifact/recent-1',
              mimeType: 'text/plain',
              sha256: 'recent-1',
              size: 88,
            },
          },
        ],
      },
    } as any);

    expect(state?.verifyArtifact?.handle).toBe('s8p://artifact/verify-from-result');
    expect(state?.recentReadArtifacts?.[0]?.path).toBe('src/recent.ts');
  });
});
