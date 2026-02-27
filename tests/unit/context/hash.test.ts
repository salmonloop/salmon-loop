import { describe, expect, it } from 'bun:test';

import {
  createContextHash,
  createIntentSignature,
  createTargetSetSignature,
} from '../../../src/core/context/hash.js';
import type { Context, ContextTarget } from '../../../src/core/types/context.js';

describe('context hash utilities', () => {
  it('creates stable intent signatures', () => {
    const a = createIntentSignature({
      instruction: 'fix x',
      primaryFile: 'src/a.ts',
      selection: 'L1',
      diffScope: 'primary',
    });
    const b = createIntentSignature({
      diffScope: 'primary',
      selection: 'L1',
      primaryFile: 'src/a.ts',
      instruction: 'fix x',
    });
    expect(a).toBe(b);
    expect(a.startsWith('intent:v1:')).toBe(true);
  });

  it('creates order-independent target set signatures', () => {
    const a = createTargetSetSignature([
      { path: 'src/b.ts', reason: 'import_neighbor', confidence: 'medium' },
      { path: 'src/a.ts', reason: 'primary', confidence: 'high' },
    ] as ContextTarget[]);
    const b = createTargetSetSignature([
      { path: 'src/a.ts', reason: 'primary', confidence: 'high' },
      { path: 'src/b.ts', reason: 'import_neighbor', confidence: 'medium' },
    ] as ContextTarget[]);
    expect(a).toBe(b);
    expect(a.startsWith('targets:v1:')).toBe(true);
  });

  it('creates stable context hash for object key ordering differences', () => {
    const a = createContextHash({
      repoPath: '/repo',
      instruction: 'fix',
      rgSnippets: [],
      targets: [{ path: 'src/a.ts', reason: 'primary', confidence: 'high' }],
      projectMetadata: { readmeHeader: 'x', configFiles: ['a', 'b'] },
    } as Context);
    const b = createContextHash({
      repoPath: '/repo',
      rgSnippets: [],
      projectMetadata: { configFiles: ['a', 'b'], readmeHeader: 'x' },
      targets: [{ confidence: 'high', reason: 'primary', path: 'src/a.ts' }],
      instruction: 'fix',
    } as Context);
    expect(a).toBe(b);
    expect(a.startsWith('context:v1:')).toBe(true);
  });
});
