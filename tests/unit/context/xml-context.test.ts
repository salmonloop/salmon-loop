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

  it('renders symbol_map and deep analysis fields', () => {
    const ctx: Context = {
      repoPath: '/repo',
      primaryFile: 'src/a.ts',
      primaryText: 'if (a) { throw new Error() }\n',
      rgSnippets: [],
      symbolMap: {
        nodes: [
          {
            id: 'def:foo:1:1',
            name: 'foo',
            kind: 'definition',
            path: 'src/a.ts',
            location: { start: { line: 1, column: 1 }, end: { line: 1, column: 4 } },
          },
          {
            id: 'ref:foo:2:3',
            name: 'foo',
            kind: 'reference',
            path: 'src/a.ts',
            location: { start: { line: 2, column: 3 }, end: { line: 2, column: 6 } },
          },
        ],
        edges: [{ from: 'ref:foo:2:3', to: 'def:foo:1:1', type: 'call', confidence: 'high' }],
      },
      analysis: {
        ast: {
          controlFlow: {
            branchCount: 3,
            loopCount: 1,
            asyncBoundaryCount: 2,
            hotspots: ['dense_branching'],
          },
          exceptionPaths: {
            tryCatchCount: 1,
            throwCount: 2,
            promiseCatchCount: 1,
            hotspots: ['multiple_throw_sites'],
          },
        },
      },
    };

    const out = formatContextForXmlPrompt(ctx);
    expect(out).toContain('<symbol_map>');
    expect(out).toContain('node id="def:foo:1:1"');
    expect(out).toContain('edge from="ref:foo:2:3" to="def:foo:1:1" type="call"');
    expect(out).toContain('<control_flow branches="3" loops="1" async_boundaries="2">');
    expect(out).toContain('<exception_paths try_catch="1" throws="2" promise_catch="1">');
  });
});
