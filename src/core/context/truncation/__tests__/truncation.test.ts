/**
 * Tests for Semantic Truncation.
 */

import { describe, it, expect } from 'bun:test';

import {
  SemanticTruncator,
  truncateOutput,
  detectOutputType,
  ErrorStackStrategy,
  JsonStrategy,
  GitDiffStrategy,
  LogStrategy,
  TestResultStrategy,
  GenericStrategy,
} from '../index.js';

describe('detectOutputType', () => {
  it('should detect error stack', () => {
    const output = `Error: Something went wrong
    at function1 (file.js:10:5)
    at function2 (file.js:20:10)`;
    const result = detectOutputType(output);
    expect(result.type).toBe('error_stack');
  });

  it('should detect JSON', () => {
    const output = JSON.stringify({ key: 'value', nested: { a: 1 } });
    const result = detectOutputType(output);
    expect(result.type).toBe('json');
  });

  it('should detect git diff', () => {
    const output = `diff --git a/file.ts b/file.ts
index abc1234..def5678 100644
--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,5 @@`;
    const result = detectOutputType(output);
    expect(result.type).toBe('git_diff');
  });

  it('should detect test result', () => {
    const output = `Tests: 10 passed, 2 failed
FAIL: test case 1
Error: expected true but got false`;
    const result = detectOutputType(output);
    expect(result.type).toBe('test_result');
  });

  it('should detect log output', () => {
    const output = `2024-01-01 10:00:00 ERROR Something failed
2024-01-01 10:00:01 WARN Warning message
2024-01-01 10:00:02 INFO Normal message`;
    const result = detectOutputType(output);
    expect(result.type).toBe('log');
  });

  it('should return generic for unknown output', () => {
    const output = 'Just some random text without any patterns.';
    const result = detectOutputType(output);
    expect(result.type).toBe('generic');
  });
});

describe('ErrorStackStrategy', () => {
  const strategy = new ErrorStackStrategy();

  it('should not truncate small output', () => {
    const output = 'Error: Small error\n    at test (file.js:1:1)';
    const result = strategy.truncate(output, 1000);
    expect(result.wasTruncated).toBe(false);
    expect(result.content).toBe(output);
  });

  it('should preserve error messages when truncating', () => {
    const output = `Error: Critical error
    at func1 (file.js:1:1)
    at func2 (file.js:2:2)
${'x'.repeat(5000)}`;
    const result = strategy.truncate(output, 500);
    expect(result.wasTruncated).toBe(true);
    expect(result.content).toContain('Error: Critical error');
    expect(result.keyInfoPreserved).toContain('error_messages');
  });
});

describe('JsonStrategy', () => {
  const strategy = new JsonStrategy();

  it('should not truncate small JSON', () => {
    const output = JSON.stringify({ a: 1, b: 2 });
    const result = strategy.truncate(output, 1000);
    expect(result.wasTruncated).toBe(false);
  });

  it('should truncate large arrays', () => {
    const arr = Array.from({ length: 100 }, (_, i) => ({ id: i, data: 'x'.repeat(50) }));
    const output = JSON.stringify(arr);
    const result = strategy.truncate(output, 500);
    expect(result.wasTruncated).toBe(true);
  });

  it('should preserve object keys', () => {
    const obj = { key1: 'x'.repeat(5000), key2: 'y'.repeat(5000) };
    const output = JSON.stringify(obj);
    const result = strategy.truncate(output, 200);
    expect(result.keyInfoPreserved).toContain('structure');
  });
});

describe('GitDiffStrategy', () => {
  const strategy = new GitDiffStrategy();

  it('should preserve hunk headers', () => {
    const output = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,5 +1,5 @@
 context line
-removed line
+added line
 context line`;
    const result = strategy.truncate(output, 200);
    expect(result.content).toContain('@@ -1,5 +1,5 @@');
    expect(result.keyInfoPreserved).toContain('hunk_header');
  });

  it('should preserve file headers', () => {
    const output = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
${'+line\n'.repeat(100)}`;
    const result = strategy.truncate(output, 200);
    expect(result.content).toContain('diff --git');
    expect(result.content).toContain('--- a/file.ts');
    expect(result.content).toContain('+++ b/file.ts');
    expect(result.keyInfoPreserved).toContain('file_headers');
  });
});

describe('LogStrategy', () => {
  const strategy = new LogStrategy();

  it('should prioritize error lines', () => {
    const output = `INFO: Starting
INFO: Processing
ERROR: Something failed
INFO: Continuing
ERROR: Another failure`;
    const result = strategy.truncate(output, 100);
    expect(result.content).toContain('ERROR: Something failed');
    expect(result.keyInfoPreserved).toContain('error_lines');
  });

  it('should preserve context around important lines', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `INFO: Line ${i}`);
    lines.splice(10, 0, 'ERROR: Critical error');
    const output = lines.join('\n');
    const result = strategy.truncate(output, 300);
    expect(result.wasTruncated).toBe(true);
  });
});

describe('TestResultStrategy', () => {
  const strategy = new TestResultStrategy();

  it('should preserve failure information', () => {
    const output = `Tests: 5 passed, 2 failed
FAIL: test case 1
Error: expected true
FAIL: test case 2
Error: expected false`;
    const result = strategy.truncate(output, 500);
    expect(result.content).toContain('2 failed');
    expect(result.content).toContain('FAIL: test case 1');
    expect(result.keyInfoPreserved).toContain('failures');
  });

  it('should preserve summary', () => {
    const output = `Tests: 100 passed, 0 failed
${'✓ test\n'.repeat(100)}`;
    const result = strategy.truncate(output, 200);
    expect(result.content).toContain('Tests: 100 passed');
    expect(result.keyInfoPreserved).toContain('summary');
  });
});

describe('GenericStrategy', () => {
  const strategy = new GenericStrategy();

  it('should not truncate small output', () => {
    const output = 'Small content';
    const result = strategy.truncate(output, 1000);
    expect(result.wasTruncated).toBe(false);
  });

  it('should truncate with head and tail', () => {
    const output = 'x'.repeat(1000);
    const result = strategy.truncate(output, 100);
    expect(result.wasTruncated).toBe(true);
    expect(result.keyInfoPreserved).toContain('head');
    expect(result.keyInfoPreserved).toContain('tail');
    expect(result.content.length).toBeLessThanOrEqual(100);
  });
});

describe('SemanticTruncator', () => {
  const truncator = new SemanticTruncator();

  it('should auto-detect type and truncate', () => {
    const output = `Error: Test error\n    at func (file.js:1:1)`;
    const result = truncator.truncate(output, 500);
    expect(result.strategy).toBe('error_stack');
  });

  it('should accept type hint', () => {
    const output = '{"key": "value"}';
    const result = truncator.truncate(output, 500, 'json');
    expect(result.strategy).toBe('json');
  });

  it('should truncate with explicit type', () => {
    const output = 'x'.repeat(1000);
    const result = truncator.truncateWithType(output, 'generic', 100);
    expect(result.wasTruncated).toBe(true);
  });
});

describe('truncateOutput convenience function', () => {
  it('should work without type hint', () => {
    const output = 'Error: Test\n    at func (file.js:1:1)';
    const result = truncateOutput(output, 500);
    expect(result.strategy).toBe('error_stack');
  });

  it('should work with type hint', () => {
    const output = 'x'.repeat(1000);
    const result = truncateOutput(output, 100, 'log');
    expect(result.wasTruncated).toBe(true);
  });
});
