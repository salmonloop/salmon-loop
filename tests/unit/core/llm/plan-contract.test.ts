import { describe, expect, it } from 'bun:test';

import { parsePlanFromLLMContent } from '../../../../src/core/llm/utils.js';
import { text } from '../../../../src/locales/index.js';

describe('PLAN contract parsing', () => {
  const validPlan = {
    goal: 'Update example',
    files: ['src/example.ts'],
    changes: ['Adjust example output'],
    verify: 'bun test',
  };

  it('accepts a strict single JSON object with required keys', () => {
    const content = JSON.stringify(validPlan);
    const parsed = parsePlanFromLLMContent(content);
    expect(parsed.goal).toBe(validPlan.goal);
    expect(parsed.files).toEqual(validPlan.files);
  });

  it('rejects leading labels or wrapped output', () => {
    const content = `Final answer: ${JSON.stringify(validPlan)}`;
    expect(() => parsePlanFromLLMContent(content)).toThrow(text.llm.planInvalidJson);
  });

  it('rejects trailing text after a JSON object', () => {
    const content = `${JSON.stringify(validPlan)}\nextra`;
    expect(() => parsePlanFromLLMContent(content)).toThrow(text.llm.planInvalidJson);
  });

  it('rejects fenced JSON blocks', () => {
    const content = `\`\`\`json\n${JSON.stringify(validPlan)}\n\`\`\``;
    expect(() => parsePlanFromLLMContent(content)).toThrow(text.llm.planInvalidJson);
  });

  it('rejects objects that miss required keys', () => {
    const content = JSON.stringify({ goal: 'incomplete' });
    expect(() => parsePlanFromLLMContent(content)).toThrow(text.llm.planInvalid);
  });
});
