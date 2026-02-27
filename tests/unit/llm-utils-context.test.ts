import { describe, test, expect } from 'bun:test';

import { formatContextForPrompt } from '../../src/core/llm/utils.js';
import type { Context } from '../../src/core/types/context.js';

describe('LLM Utils - Context Formatting', () => {
  const mockContext: Context = {
    repoPath: '/test/repo',
    primaryFile: 'src/test.ts',
    primaryText: 'export const test = "hello";',
    rgSnippets: [],
  };

  test('should format context as JSON by default now that migration is complete', () => {
    const output = formatContextForPrompt(mockContext);
    const parsed = JSON.parse(output);
    expect(parsed.c).toBeDefined();
    expect(parsed.c.pf).toContain('src/test.ts');
  });

  test('should format context as XML when explicitly requested', () => {
    const output = formatContextForPrompt(mockContext, { format: 'xml' });
    expect(output).toContain('<context>');
    expect(output).toContain('<primary_file');
  });
});
