import { CodeSearchInput } from '../../src/core/tools/builtin/code-search/spec.js';

describe('code.search input schema', () => {
  it('coerces maxMatches and isRegex when provided as strings', () => {
    const parsed = CodeSearchInput.safeParse({
      pattern: 'export class',
      maxMatches: '50',
      isRegex: 'true',
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.maxMatches).toBe(50);
    expect(parsed.data.isRegex).toBe(true);
  });
});
