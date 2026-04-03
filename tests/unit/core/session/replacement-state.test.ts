import { describe, expect, it } from 'bun:test';

import {
  TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM,
  TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION,
  TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION,
  createToolResultIdentity,
  freezeToolResultReplacementDecision,
  normalizeToolResultReplacementState,
} from '../../../../src/core/session/replacement-state.js';
import type {
  ToolResultReplacementEntry,
  ToolResultReplacementState,
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

  it('produces the expected identity literal for canonical payloads', () => {
    expect(
      createToolResultIdentity({
        canonicalToolCallIdentity: 'fs.read:{"file":"a.ts"}',
        payload: {
          message: 'line1\r\nline2',
          numbers: [3, 1, 2],
          metadata: { extra: 'value' },
        },
      }),
    ).toBe('001f16117c51ba5088321675329e73c4f738191e6fa8dab54ac2491753799598');
  });

  it('removes entries whose identityVersion no longer matches while keeping valid entries', () => {
    const normalized = normalizeToolResultReplacementState({
      schemaVersion: TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION,
      entries: {
        retained: {
          toolResultId: 'retained',
          decision: 'replaced',
          preview: 'preview-retained',
          frozenAt: 1,
          identityVersion: TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION,
          hashAlgorithm: TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM,
        },
        dropped: {
          toolResultId: 'dropped',
          decision: 'replaced',
          preview: 'preview-dropped',
          frozenAt: 1,
          identityVersion: 'v2' as unknown as typeof TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION,
          hashAlgorithm: TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM,
        },
      },
    } as unknown as ToolResultReplacementState);

    expect(normalized?.entries.retained).toBeDefined();
    expect(normalized?.entries.dropped).toBeUndefined();
  });

  it('evicts the oldest frozen entries when bounded by maxEntries', () => {
    const makeEntry = (id: string, time: number) =>
      ({
        toolResultId: id,
        decision: 'replaced',
        preview: `${id}-preview`,
        frozenAt: time,
      } satisfies Parameters<typeof freezeToolResultReplacementDecision>[1]);

    const first = freezeToolResultReplacementDecision(undefined, makeEntry('tool-a', 1), {
      maxEntries: 2,
    });
    const second = freezeToolResultReplacementDecision(first, makeEntry('tool-b', 2), {
      maxEntries: 2,
    });
    const third = freezeToolResultReplacementDecision(second, makeEntry('tool-c', 3), {
      maxEntries: 2,
    });

    expect(third.entries['tool-a']).toBeUndefined();
    expect(Object.keys(third.entries)).toEqual(['tool-b', 'tool-c']);
    expect(third.entries['tool-b']?.frozenAt).toBe(2);
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
      schemaVersion: TOOL_RESULT_REPLACEMENT_STATE_SCHEMA_VERSION,
      entries: {
        'tool-1': {
          toolResultId: 'tool-1',
          decision: 'replaced',
          preview: 'preview-1',
          frozenAt: 1,
          sourceArtifactHandle: 's8p://artifact/1',
          identityVersion: TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION,
          hashAlgorithm: TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM,
        },
        bad: {
          toolResultId: 'bad',
          decision: 'invalid' as ToolResultReplacementEntry['decision'],
          preview: 'x',
          frozenAt: 1,
          identityVersion: TOOL_RESULT_REPLACEMENT_IDENTITY_VERSION,
          hashAlgorithm: TOOL_RESULT_REPLACEMENT_HASH_ALGORITHM,
        },
      },
    } as unknown as ToolResultReplacementState);

    expect(normalized?.entries['tool-1']).toBeDefined();
    expect(normalized?.entries.bad).toBeUndefined();
  });

  it('drops unsupported schema versions for backward compatibility safety', () => {
    const normalized = normalizeToolResultReplacementState({
      schemaVersion: 2,
      entries: {},
    } as unknown as ToolResultReplacementState);
    expect(normalized).toBeUndefined();
  });
});
