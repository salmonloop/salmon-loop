import { formatContextForXmlPrompt } from '../../../src/core/context/formatters/xml-context.js';
import type { Context } from '../../../src/core/types/index.js';

describe('formatContextForXmlPrompt (analysis limits)', () => {
  it('caps parse_error length, syntax_errors, and notes', () => {
    const parseError = 'E'.repeat(10_000);
    const ctx: Context = {
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
      primaryText: 'console.log("hi")\n',
      rgSnippets: [],
      analysis: {
        ast: {
          languageId: 'ts',
          parseError,
          syntaxErrors: Array.from({ length: 200 }, (_, i) => ({
            line: i + 1,
            column: 1,
            type: 'ERROR',
            text: `err-${i}`,
          })),
          notes: Array.from({ length: 50 }, (_, i) => `note-${i}-${'n'.repeat(1000)}`),
        },
      },
    };

    const out = formatContextForXmlPrompt(ctx);

    // parse_error is capped
    expect(out.includes('E'.repeat(4000))).toBe(true);
    expect(out.includes('E'.repeat(4001))).toBe(false);

    // syntax errors are capped
    expect(out.split('<error ').length - 1).toBe(50);

    // notes are capped and each note content is capped
    expect(out.split('<note>').length - 1).toBe(10);
    expect(out.includes('n'.repeat(501))).toBe(false);
  });

  it('renders repo_map inside manifest when available', () => {
    const ctx: Context = {
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
      primaryText: 'export const a = 1;\n',
      rgSnippets: [],
      repoMap: {
        trigger: 'deep',
        maxDepth: 3,
        nodes: [
          { path: 'src/a.ts', depth: 0, source: 'primary' },
          { path: 'src/b.ts', depth: 1, source: 'import' },
        ],
        edges: [{ from: 'src/a.ts', to: 'src/b.ts', type: 'import' }],
      },
    };

    const out = formatContextForXmlPrompt(ctx);
    expect(out).toContain('<repo_map trigger="deep" max_depth="3">');
    expect(out).toContain('<node path="src/a.ts" depth="0" source="primary" />');
    expect(out).toContain('<edge from="src/a.ts" to="src/b.ts" type="import" />');
  });
});
