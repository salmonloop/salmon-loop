import { describe, expect, it } from 'vitest';

import { OpenAILLM, StubLLM, AiSdkLLM } from '../../src/core/llm/index.js';

describe('core llm exports', () => {
  it('exposes all expected llm implementations from domain index', () => {
    expect(typeof OpenAILLM).toBe('function');
    expect(typeof StubLLM).toBe('function');
    expect(typeof AiSdkLLM).toBe('function');
  });
});
