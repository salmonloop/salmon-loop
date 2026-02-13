import { extractUnifiedDiffFromLLMContent } from '../../src/core/llm/utils.js';

describe('extractUnifiedDiffFromLLMContent', () => {
  it('extracts the last fenced diff block even when it starts with --- a/', () => {
    const content = [
      'First attempt:',
      '```diff',
      'diff --git a/a b/a',
      '--- a/a',
      '+++ b/a',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      '```',
      '',
      'Second attempt:',
      '```diff',
      '--- a/b',
      '+++ b/b',
      '@@ -1 +1 @@',
      '-old2',
      '+new2',
      '```',
      '',
    ].join('\n');

    const extracted = extractUnifiedDiffFromLLMContent(content);
    expect(extracted.trimStart().startsWith('--- a/b')).toBe(true);
    expect(extracted).toContain('+++ b/b');
    expect(extracted).toContain('+new2');
  });
});
