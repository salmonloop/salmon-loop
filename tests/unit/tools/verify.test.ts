import { describe, expect, it } from 'bun:test';

import { parseJestOutput } from '../../../src/core/feedback/parsers.js';
import { verifyRunSpec } from '../../../src/core/tools/builtin/verify.js';
import { parseTestSummary } from '../../../src/core/verification/runner.js';

describe('test.run output schema', () => {
  it('should accept minimal input', () => {
    expect(verifyRunSpec.inputSchema.safeParse({ command: 'echo ok' }).success).toBe(true);
  });

  it('should reject missing command', () => {
    expect(verifyRunSpec.inputSchema.safeParse({}).success).toBe(false);
  });
});

describe('parseTestSummary', () => {
  it('should parse jest/vitest format', () => {
    const output = `
FAIL src/foo.test.ts
PASS src/bar.test.ts

Tests: 2 failed, 5 passed, 7 total
Test Suites: 1 failed, 1 passed, 2 total
`;
    const result = parseTestSummary(output);
    expect(result).toBeDefined();
    expect(result!.failed).toBe(2);
    expect(result!.passed).toBe(5);
    expect(result!.total).toBe(7);
  });

  it('should parse pytest format', () => {
    const output = `========================= short test summary info ==========================
FAILED tests/test_foo.py::test_bar - AssertionError
========================= 2 failed, 5 passed ==========================`;
    const result = parseTestSummary(output);
    expect(result).toBeDefined();
    expect(result!.failed).toBe(2);
    expect(result!.passed).toBe(5);
  });

  it('should parse bun test format', () => {
    const output = `
 5 pass | 1 fail
Ran 6 tests across 2 files
`;
    const result = parseTestSummary(output);
    expect(result).toBeDefined();
    expect(result!.passed).toBe(5);
    expect(result!.failed).toBe(1);
  });

  it('should parse generic N passed/N failed format', () => {
    const output = '3 passing, 1 failing';
    const result = parseTestSummary(output);
    expect(result).toBeDefined();
    expect(result!.passed).toBe(3);
    expect(result!.failed).toBe(1);
  });

  it('should return undefined for unrecognizable output', () => {
    expect(parseTestSummary('Hello world')).toBeUndefined();
    expect(parseTestSummary('')).toBeUndefined();
  });
});

describe('parseJestOutput', () => {
  it('should parse FAIL suite lines', () => {
    const output = `FAIL src/components/Button.test.tsx
  ● Button > renders correctly

    expect(received).toBe(expected)

    Expected: "Click me"
    Received: "click"

    at Object.<anonymous> (src/components/Button.test.tsx:10:5)

PASS src/components/Input.test.tsx`;
    const diagnostics = parseJestOutput(output);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].file).toBe('src/components/Button.test.tsx');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].source).toBe('jest');
  });

  it('should parse inline error format', () => {
    const output = 'src/app.ts:10:5 - error TS2322: Type string is not assignable to type number.';
    const diagnostics = parseJestOutput(output);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].file).toBe('src/app.ts');
    expect(diagnostics[0].line).toBe(10);
    expect(diagnostics[0].column).toBe(5);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].source).toBe('jest');
  });

  it('should return empty for non-jest output', () => {
    expect(parseJestOutput('Hello world')).toEqual([]);
  });
});
