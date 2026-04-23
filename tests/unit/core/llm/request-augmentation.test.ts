import { describe, expect, it } from 'bun:test';

import { augmentPromptWithRelevantMemory } from '../../../../src/core/llm/request-augmentation.js';

describe('request-augmentation', () => {
  it('injects all selected entries when the memory budget fits', () => {
    const result = augmentPromptWithRelevantMemory({
      basePrompt: 'CTX',
      selectedEntries: [
        { path: 'a', title: 'A', summary: 'alpha' },
        { path: 'b', title: 'B', summary: 'beta' },
      ],
      budgetTokens: 32,
      countTokens: () => 3,
    });

    expect(result.prompt).toContain('[Relevant memory]');
    expect(result.prompt).toContain('alpha');
    expect(result.prompt).toContain('beta');
    expect(result.injectedEntries).toHaveLength(2);
  });

  it('drops whole memory entries when the augmentation budget is too small', () => {
    const result = augmentPromptWithRelevantMemory({
      basePrompt: 'CTX',
      selectedEntries: [
        { path: 'a', title: 'A', summary: 'alpha' },
        { path: 'b', title: 'B', summary: 'beta' },
      ],
      budgetTokens: 6,
      countTokens: () => 3,
    });

    expect(result.prompt).toContain('alpha');
    expect(result.prompt).not.toContain('beta');
    expect(result.injectedEntries).toEqual([{ path: 'a', title: 'A', summary: 'alpha' }]);
  });

  it('skips injection when the memory budget cannot fit even one entry', () => {
    const result = augmentPromptWithRelevantMemory({
      basePrompt: 'CTX',
      selectedEntries: [{ path: 'a', title: 'A', summary: 'alpha' }],
      budgetTokens: 2,
      countTokens: () => 3,
    });

    expect(result.prompt).toBe('CTX');
    expect(result.injectedEntries).toEqual([]);
  });
});
