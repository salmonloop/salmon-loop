import { describe, expect, it } from 'vitest';

import { OpenAILLM as DomainOpenAILLM } from '../../src/core/llm/index.js';
import { OpenAILLM as RootOpenAILLM } from '../../src/core/llm.js';

describe('core root facade migration', () => {
  it('keeps llm root facade pointing to the domain module', () => {
    expect(RootOpenAILLM).toBe(DomainOpenAILLM);
  });
});
