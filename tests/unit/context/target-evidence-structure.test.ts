import { describe, expect, it } from 'bun:test';

import type { ContextTarget, TargetEvidence } from '../../../src/core/types/context.js';

describe('TargetEvidence structured format', () => {
  it('accepts string evidence for backward compatibility', () => {
    const target: ContextTarget = {
      path: 'foo.ts',
      reason: 'symbol_definition',
      confidence: 'high',
      evidence: 'symbol:foo@1:10',
    };

    expect(target.evidence).toBe('symbol:foo@1:10');
  });

  it('accepts structured TargetEvidence', () => {
    const evidence: TargetEvidence = {
      type: 'symbol',
      details: {
        symbolName: 'foo',
        location: { line: 1, column: 10 },
        matchType: 'definition',
        source: 'symbolMap',
      },
    };

    const target: ContextTarget = {
      path: 'foo.ts',
      reason: 'symbol_definition',
      confidence: 'high',
      evidence,
    };

    expect(target.evidence).toEqual(evidence);
    if (typeof target.evidence === 'object') {
      expect(target.evidence.type).toBe('symbol');
      expect(target.evidence.details?.symbolName).toBe('foo');
      expect(target.evidence.details?.source).toBe('symbolMap');
    }
  });

  it('supports diffusion metadata in structured evidence', () => {
    const evidence: TargetEvidence = {
      type: 'symbol',
      details: {
        symbolName: 'helper',
        matchType: 'call',
        source: 'symbolMap',
        distance: 2,
        weight: 6,
      },
    };

    const target: ContextTarget = {
      path: 'utils.ts',
      reason: 'symbol_definition',
      confidence: 'medium',
      evidence,
    };

    if (typeof target.evidence === 'object') {
      expect(target.evidence.details?.distance).toBe(2);
      expect(target.evidence.details?.weight).toBe(6);
    }
  });

  it('supports legacy string evidence in raw field', () => {
    const evidence: TargetEvidence = {
      type: 'symbol',
      details: {
        symbolName: 'bar',
        location: { line: 5, column: 3 },
      },
      raw: 'symbol:bar@5:3',
    };

    const target: ContextTarget = {
      path: 'bar.ts',
      reason: 'symbol_definition',
      confidence: 'high',
      evidence,
    };

    if (typeof target.evidence === 'object') {
      expect(target.evidence.raw).toBe('symbol:bar@5:3');
    }
  });

  it('supports different evidence types', () => {
    const types: TargetEvidence['type'][] = [
      'symbol',
      'path',
      'diff',
      'import',
      'ripgrep',
      'fallback',
    ];

    for (const type of types) {
      const evidence: TargetEvidence = { type };
      const target: ContextTarget = {
        path: 'test.ts',
        reason: 'fallback',
        confidence: 'low',
        evidence,
      };

      if (typeof target.evidence === 'object') {
        expect(target.evidence.type).toBe(type);
      }
    }
  });
});
