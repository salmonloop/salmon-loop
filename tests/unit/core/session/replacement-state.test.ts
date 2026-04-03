import { describe, expect, it } from 'bun:test';

import {
  createToolResultIdentity,
  freezeToolResultReplacementDecision,
  normalizeToolResultReplacementState,
} from '../../../../src/core/session/replacement-state.js';

describe('session/replacement-state', () => {
  it('creates deterministic tool result identity for canonical payloads', () => {
    const a = createToolResultIdentity({
      canonicalToolCallIdentity: 'fs.read:{"file":"a.ts"}',
      payload: { b: 1, a: ['x', 'y'] },
    });
    const b = createToolResultIdentity({
      canonicalToolCallIdentity: 'fs.read:{"file":"a.ts"}',
      payload: { a: ['x', 'y'], b: 1 },
    });
    expect(a).toBe(b);
  });

  it('freezes decisions and does not allow later flip for same identity', () => {
    const frozen = freezeToolResultReplacementDecision(undefined, {
      toolResultId: 'tool-1',
      decision: 'replaced',
      preview: 'preview-1',
      sourceArtifactHandle: 's8p://artifact/1',
      frozenAt: 1,
    });
    const reapply = freezeToolResultReplacementDecision(frozen, {
      toolResultId: 'tool-1',
      decision: 'kept',
      preview: 'preview-2',
      sourceArtifactHandle: 's8p://artifact/2',
      frozenAt: 2,
    });

    expect(reapply.entries['tool-1']?.decision).toBe('replaced');
    expect(reapply.entries['tool-1']?.preview).toBe('preview-1');
  });

  it('keeps valid frozen entries when partial persisted state is invalid', () => {
    const normalized = normalizeToolResultReplacementState({
      schemaVersion: 1,
      entries: {
        'tool-1': {
          toolResultId: 'tool-1',
          decision: 'replaced',
          preview: 'preview-1',
          frozenAt: 1,
          sourceArtifactHandle: 's8p://artifact/1',
          identityVersion: 'v1',
          hashAlgorithm: 'sha256',
        },
        bad: {
          toolResultId: 'bad',
          decision: 'invalid',
          preview: 'x',
          frozenAt: 1,
          identityVersion: 'v1',
          hashAlgorithm: 'sha256',
        } as any,
      },
    });

    expect(normalized?.entries['tool-1']).toBeDefined();
    expect(normalized?.entries.bad).toBeUndefined();
  });

  it('drops unsupported schema versions for backward compatibility safety', () => {
    const normalized = normalizeToolResultReplacementState({
      schemaVersion: 2 as any,
      entries: {},
    });
    expect(normalized).toBeUndefined();
  });
});
