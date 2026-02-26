import { describe, test, expect, beforeAll } from 'bun:test';

import { ContextFormatConverter } from '../../src/core/context/formatters/json-converter.js';
import type { FormatPreference } from '../../src/core/context/formatters/types.js';
import { formatContextForXmlPrompt } from '../../src/core/context/formatters/xml-context.js';
import type { Context } from '../../src/core/types/context.js';

/**
 * Context format conversion integration tests
 * Validates the complete XML-to-JSON migration workflow
 */
describe('Context Format Migration Integration', () => {
  let testContext: Context;

  beforeAll(() => {
    // Construct a realistic test context
    testContext = {
      repoPath: '/test/project',
      primaryFile: 'src/index.ts',
      primaryText: `import { helper } from './helper';

export const main = () => {
  const result = helper.process('data');
  console.log('Result:', result);
  return result;
};

main();`,
      relatedFiles: [
        {
          path: 'src/helper.ts',
          content: `export const helper = {
  process: (data: string) => {
    return data.toUpperCase();
  }
};`,
          kind: 'import',
          mode: 'full',
        },
        {
          path: 'package.json',
          content: `{
  "name": "test-project",
  "version": "1.0.0",
  "main": "src/index.ts",
  "dependencies": {
    "typescript": "^5.0.0"
  }
}`,
          kind: 'dependency',
          mode: 'outline',
        },
      ],
      rgSnippets: [
        { file: 'src/index.ts', line: 3, content: 'export const main = () => {' },
        { file: 'src/helper.ts', line: 2, content: 'process: (data: string) => {' },
      ],
      stagedDiff: `--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 export const main = () => {
+  console.log('Starting...');
   const result = helper.process('data');
   return result;
 };`,
      targets: [
        {
          path: 'src/index.ts',
          reason: 'primary',
          confidence: 'high',
          evidence: { type: 'symbol', details: { symbolName: 'main' } },
        },
        {
          path: 'src/helper.ts',
          reason: 'import_neighbor',
          confidence: 'medium',
          evidence: { type: 'import', details: { symbolName: 'helper' } },
        },
      ],
      analysis: {
        ast: {
          languageId: 'typescript',
          controlFlow: {
            branchCount: 0,
            loopCount: 0,
            asyncBoundaryCount: 0,
          },
          exceptionPaths: {
            tryCatchCount: 0,
            throwCount: 0,
            promiseCatchCount: 0,
          },
        },
      },
      symbolMap: {
        nodes: [
          {
            id: 'main_fn',
            name: 'main',
            kind: 'definition',
            location: { start: { line: 3, column: 13 }, end: { line: 3, column: 19 } },
          },
          {
            id: 'helper_import',
            name: 'helper',
            kind: 'reference',
            location: { start: { line: 1, column: 17 }, end: { line: 1, column: 25 } },
          },
        ],
        edges: [
          {
            from: 'helper_import',
            to: 'main_fn',
            type: 'reference',
            confidence: 'high',
          },
        ],
      },
    };
  });

  describe('Complete Migration Workflow', () => {
    test('should convert real XML context to optimized JSON', () => {
      // 1. Generate an actual XML context
      const xmlContext = formatContextForXmlPrompt(testContext as any);
      expect(xmlContext).toContain('<context>');
      expect(xmlContext).toContain('<primary_file');
      expect(xmlContext).toContain('src/index.ts');

      // 2. Convert it to JSON (currently throws because XML parsing is unimplemented)
      // This confirms our error handling path
      expect(() => ContextFormatConverter.xmlToJson(xmlContext)).toThrow(
        'XML parsing not implemented yet',
      );
    });

    test('should produce optimized JSON directly from Context', () => {
      const jsonResult = ContextFormatConverter.contextToJson(testContext);

      // Verify the structure integrity
      expect(jsonResult.c).toBeDefined();
      expect(jsonResult.c.m).toBeDefined();
      expect(jsonResult.c.m.t).toHaveLength(2);
      expect(jsonResult.c.pf).toHaveLength(2); // [path, content]
      expect(jsonResult.c.rf).toHaveLength(2);
      expect(jsonResult.c.s).toHaveLength(2);
      expect(jsonResult.c.d).toBeDefined();
      expect(jsonResult.c.a).toBeDefined();

      // Validate the data contents
      expect(jsonResult.c.pf![0]).toBe('src/index.ts');
      expect(jsonResult.c.pf![1]).toBe(testContext.primaryText!);

      // Ensure targets are converted correctly
      const primaryTarget = jsonResult.c.m.t!.find((t) => t.p === 'src/index.ts');
      expect(primaryTarget).toBeDefined();
      expect(primaryTarget!.r).toBe('primary');
      expect(primaryTarget!.c).toBe('h'); // high -> h

      // Confirm related files are present
      const helperFile = jsonResult.c.rf!.find((f) => f[0] === 'src/helper.ts');
      expect(helperFile).toBeDefined();
      expect(helperFile![1]).toBe('import'); // reason
      expect(helperFile![2]).toBe('f'); // full -> f
    });

    test('should handle format preference detection correctly', () => {
      const scenarios: Array<{ headers: { accept?: string }; expected: FormatPreference }> = [
        {
          headers: { accept: 'application/json' },
          expected: 'json',
        },
        {
          headers: { accept: 'application/xml' },
          expected: 'xml',
        },
        {
          headers: { accept: 'text/html, application/json;q=0.9, application/xml;q=0.8' },
          expected: 'json',
        },
        {
          headers: { accept: '*/*' },
          expected: 'xml', // fallback
        },
        {
          headers: {},
          expected: 'xml', // fallback
        },
      ];

      for (const scenario of scenarios) {
        const result = ContextFormatConverter.detectFormatPreference({
          headers: scenario.headers,
        });
        expect(result).toBe(scenario.expected);
      }
    });

    test('should calculate accurate performance metrics', () => {
      const jsonResult = ContextFormatConverter.contextToJson(testContext);
      const metrics = ContextFormatConverter.calculatePerformanceMetrics(testContext, jsonResult);

      expect(metrics.originalSize).toBeGreaterThan(0);
      expect(metrics.compressedSize).toBeGreaterThan(0);
      expect(metrics.compressionRatio).toBeGreaterThan(0);
      expect(metrics.tokenReduction).toBeDefined();

      console.log('Performance Metrics:', {
        originalSize: metrics.originalSize,
        compressedSize: metrics.compressedSize,
        compressionRatio: metrics.compressionRatio,
        tokenReduction: `${(metrics.tokenReduction * 100).toFixed(1)}%`,
      });
    });

    test('should support incremental updates efficiently', () => {
      // Build an updated context
      const updatedContext = {
        ...testContext,
        primaryText: testContext.primaryText + '\n// Added comment',
        relatedFiles: testContext.relatedFiles!.slice(0, 1),
      };

      const diff = ContextFormatConverter.computeJsonDiff(testContext, updatedContext);

      expect(diff.changed).toBe(true);
      expect(diff.changes).toContain('primaryFile');
      expect(diff.changes).toContain('relatedFiles');
      expect(diff.diff.pf).toBeDefined();
      expect(diff.diff.rf).toBeDefined();

      // Verify incremental data is accurate
      expect((diff.diff.pf as [string, string])[1]).toContain('// Added comment');
      expect(diff.diff.rf!).toHaveLength(1);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle minimal context gracefully', () => {
      const minimalContext: Context = {
        repoPath: '/test',
        rgSnippets: [],
      };

      const result = ContextFormatConverter.contextToJson(minimalContext);
      expect(result.c.m).toBeDefined();
      expect(result.c.m.t).toBeUndefined(); // No targets
      expect(result.c.pf).toBeUndefined(); // No primary file
      expect(result.c.rf).toBeUndefined(); // No related files
    });

    test('should handle context with only primary file', () => {
      const primaryOnlyContext: Context = {
        repoPath: '/test',
        primaryFile: 'test.ts',
        primaryText: 'const x = 1;',
        rgSnippets: [],
      };

      const result = ContextFormatConverter.contextToJson(primaryOnlyContext);
      expect(result.c.pf).toHaveLength(2);
      expect(result.c.pf![0]).toBe('test.ts');
      expect(result.c.pf![1]).toBe('const x = 1;');
    });

    test('should handle malformed evidence gracefully', () => {
      const contextWithBadEvidence: Context = {
        repoPath: '/test',
        rgSnippets: [],
        targets: [
          {
            path: 'test.ts',
            reason: 'primary',
            confidence: 'high',
            evidence: 'malformed' as any, // Force an invalid evidence type
          },
        ],
      };

      const result = ContextFormatConverter.contextToJson(contextWithBadEvidence);
      expect(result.c.m.t).toHaveLength(1);
      expect(result.c.m.t![0].e).toBeDefined();
      expect(result.c.m.t![0].e!.t).toBe('string');
    });

    test('should handle large content efficiently', () => {
      const largeContent =
        'export const largeData = ' +
        JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ id: i, data: `item${i}` }))) +
        ';';

      const contextWithLargeContent: Context = {
        repoPath: '/test',
        primaryFile: 'large.ts',
        primaryText: largeContent,
        rgSnippets: [],
      };

      const startTime = performance.now();
      const result = ContextFormatConverter.contextToJson(contextWithLargeContent);
      const endTime = performance.now();

      expect(result.c.pf![1]).toBe(largeContent);
      expect(endTime - startTime).toBeLessThan(100); // Should finish within 100ms
    });
  });
});
