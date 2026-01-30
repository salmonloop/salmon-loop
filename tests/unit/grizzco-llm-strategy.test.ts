import { describe, expect, it } from 'vitest';

import { resolveLlmToolCallingPolicy } from '../../src/core/grizzco/dsl/llm-strategy.js';
import { Phase, type LLM } from '../../src/core/types.js';

describe('Grizzco LLM strategy', () => {
  it('disables tool calling when the LLM does not expose capabilities', () => {
    const llm = {} as unknown as LLM;
    const policy = resolveLlmToolCallingPolicy(Phase.PLAN, llm);
    expect(policy.enabled).toBe(false);
    expect(policy.maxRounds).toBe(6);
  });

  it('disables tool calling when toolCalling capability is false', () => {
    const llm = {
      getCapabilities: () => ({ toolCalling: false }),
    } as unknown as LLM;
    const policy = resolveLlmToolCallingPolicy(Phase.PLAN, llm);
    expect(policy.enabled).toBe(false);
  });

  it('enables tool calling when toolCalling capability is true', () => {
    const llm = {
      getCapabilities: () => ({ toolCalling: true }),
    } as unknown as LLM;
    const policy = resolveLlmToolCallingPolicy(Phase.PATCH, llm);
    expect(policy.enabled).toBe(true);
    expect(policy.maxRounds).toBe(6);
  });
});
