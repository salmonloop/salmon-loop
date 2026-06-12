import { describe, expect, it } from 'bun:test';

import {
  parseEslintJson,
  parseJestJson,
  parseJestJsonSummary,
  parseJestOutput,
  parseBunTestNdjson,
  parseGoTestNdjson,
  parseRunnerOutput,
  parseStructuredSummary,
} from '../../../src/core/feedback/parsers.js';
import { verifyRunSpec } from '../../../src/core/tools/builtin/verify.js';
import {
  detectRunner,
  injectJsonFlags,
  supportsJsonOutput,
  type RunnerKind,
} from '../../../src/core/verification/detect-runner.js';
import { parseTestSummary } from '../../../src/core/verification/runner.js';

// ── Schema ──────────────────────────────────────────────────────────────────

describe('test.run input schema', () => {
  it('should accept minimal input', () => {
    expect(verifyRunSpec.inputSchema.safeParse({ command: 'echo ok' }).success).toBe(true);
  });

  it('should reject missing command', () => {
    expect(verifyRunSpec.inputSchema.safeParse({}).success).toBe(false);
  });

  it('should accept valid runner', () => {
    const result = verifyRunSpec.inputSchema.safeParse({ command: 'jest', runner: 'jest' });
    expect(result.success).toBe(true);
  });

  it('should reject invalid runner', () => {
    expect(verifyRunSpec.inputSchema.safeParse({ command: 'echo', runner: 'mocha' }).success).toBe(
      false,
    );
  });

  it('should default runner to undefined', () => {
    const result = verifyRunSpec.inputSchema.safeParse({ command: 'echo ok' });
    expect(result.success).toBe(true);
    expect(result.data!.runner).toBeUndefined();
  });
});

// ── Runner detection ────────────────────────────────────────────────────────

describe('detectRunner', () => {
  it.each<[string, RunnerKind]>([
    ['npx jest', 'jest'],
    ['jest --coverage', 'jest'],
    ['npx vitest run', 'vitest'],
    ['vitest --reporter=json', 'vitest'],
    ['pytest tests/', 'pytest'],
    ['python -m pytest -x', 'pytest'],
    ['tsc --noEmit', 'tsc'],
    ['npx tsc -p tsconfig.json', 'tsc'],
    ['eslint src/', 'eslint'],
    ['npx eslint --fix .', 'eslint'],
    ['bun test', 'bun'],
    ['bun test src/foo.test.ts', 'bun'],
    ['go test ./...', 'go'],
    ['go test -v ./pkg/...', 'go'],
    ['make test', 'unknown'],
    ['./scripts/run-tests.sh', 'unknown'],
  ])('detects %s as %s', (command, expected) => {
    expect(detectRunner(command)).toBe(expected);
  });
});

// ── JSON flag injection ─────────────────────────────────────────────────────

describe('injectJsonFlags', () => {
  it('adds --json to jest', () => {
    expect(injectJsonFlags('npx jest', 'jest')).toBe('npx jest --json');
  });

  it('does not duplicate --json', () => {
    expect(injectJsonFlags('jest --json', 'jest')).toBe('jest --json');
  });

  it('adds --reporter=json --run to vitest', () => {
    expect(injectJsonFlags('vitest run', 'vitest')).toBe('vitest run --reporter=json --run');
  });

  it('adds --format json to eslint', () => {
    expect(injectJsonFlags('eslint src/', 'eslint')).toBe('eslint src/ --format json');
  });

  it('adds --json to bun test', () => {
    expect(injectJsonFlags('bun test', 'bun')).toBe('bun test --json');
  });

  it('adds -json to go test', () => {
    expect(injectJsonFlags('go test ./...', 'go')).toBe('go test ./... -json');
  });

  it('does not modify pytest (no JSON mode)', () => {
    expect(injectJsonFlags('pytest tests/', 'pytest')).toBe('pytest tests/');
  });

  it('does not modify tsc (no JSON mode)', () => {
    expect(injectJsonFlags('tsc --noEmit', 'tsc')).toBe('tsc --noEmit');
  });

  it('does not modify unknown runner', () => {
    expect(injectJsonFlags('make test', 'unknown')).toBe('make test');
  });
});

describe('supportsJsonOutput', () => {
  it('returns true for jest, vitest, eslint, bun, go', () => {
    expect(supportsJsonOutput('jest')).toBe(true);
    expect(supportsJsonOutput('vitest')).toBe(true);
    expect(supportsJsonOutput('eslint')).toBe(true);
    expect(supportsJsonOutput('bun')).toBe(true);
    expect(supportsJsonOutput('go')).toBe(true);
  });

  it('returns false for pytest, tsc, unknown', () => {
    expect(supportsJsonOutput('pytest')).toBe(false);
    expect(supportsJsonOutput('tsc')).toBe(false);
    expect(supportsJsonOutput('unknown')).toBe(false);
  });
});

// ── parseJestJson ───────────────────────────────────────────────────────────

describe('parseJestJson', () => {
  it('parses failed tests from jest --json output', () => {
    const json = JSON.stringify({
      numPassedTests: 3,
      numFailedTests: 1,
      numTotalTests: 4,
      testResults: [
        {
          name: '/repo/src/foo.test.ts',
          assertionResults: [
            { status: 'passed', fullName: 'foo works' },
            {
              status: 'failed',
              fullName: 'foo breaks',
              failureMessages: ['Expected: 1\nReceived: 2'],
              ancestorTitles: ['Foo'],
            },
          ],
        },
      ],
    });
    const diagnostics = parseJestJson(json);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].file).toBe('/repo/src/foo.test.ts');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].source).toBe('jest');
    expect(diagnostics[0].message).toContain('Expected: 1');
  });

  it('returns empty for invalid JSON', () => {
    expect(parseJestJson('not json')).toEqual([]);
  });

  it('returns empty for all-passing suite', () => {
    const json = JSON.stringify({
      numPassedTests: 5,
      numFailedTests: 0,
      numTotalTests: 5,
      testResults: [{ name: '/repo/src/bar.test.ts', assertionResults: [{ status: 'passed' }] }],
    });
    expect(parseJestJson(json)).toEqual([]);
  });
});

describe('parseJestJsonSummary', () => {
  it('extracts summary from jest --json output', () => {
    const json = JSON.stringify({
      numPassedTests: 3,
      numFailedTests: 1,
      numTotalTests: 4,
    });
    const summary = parseJestJsonSummary(json);
    expect(summary).toEqual({ total: 4, passed: 3, failed: 1, skipped: 0 });
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseJestJsonSummary('not json')).toBeUndefined();
  });
});

// ── parseEslintJson ─────────────────────────────────────────────────────────

describe('parseEslintJson', () => {
  it('parses eslint --format json output', () => {
    const json = JSON.stringify([
      {
        filePath: '/repo/src/app.ts',
        messages: [
          { line: 10, column: 5, message: 'Unexpected var.', severity: 2, ruleId: 'no-var' },
          { line: 20, column: 1, message: 'Missing semicolon.', severity: 1, ruleId: 'semi' },
        ],
      },
    ]);
    const diagnostics = parseEslintJson(json);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0].file).toBe('/repo/src/app.ts');
    expect(diagnostics[0].line).toBe(10);
    expect(diagnostics[0].column).toBe(5);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].source).toBe('eslint');
    expect(diagnostics[0].message).toContain('no-var');
    expect(diagnostics[1].severity).toBe('warning');
  });

  it('returns empty for invalid JSON', () => {
    expect(parseEslintJson('not json')).toEqual([]);
  });

  it('returns empty for non-array JSON', () => {
    expect(parseEslintJson('{"foo": 1}')).toEqual([]);
  });
});

// ── parseBunTestNdjson ──────────────────────────────────────────────────────

describe('parseBunTestNdjson', () => {
  it('parses bun test --json NDJSON output', () => {
    const ndjson = [
      '{"type":"test-pass","data":{"file":"src/foo.test.ts","status":"pass"}}',
      '{"type":"test-fail","data":{"file":"src/foo.test.ts","status":"fail","error":{"message":"expected 1 to be 2"}}}',
      '{"type":"test-pass","data":{"file":"src/bar.test.ts","status":"pass"}}',
    ].join('\n');
    const diagnostics = parseBunTestNdjson(ndjson);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].file).toBe('src/foo.test.ts');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].source).toBe('bun');
    expect(diagnostics[0].message).toBe('expected 1 to be 2');
  });

  it('returns empty for all-passing output', () => {
    const ndjson = '{"type":"test-pass","data":{"file":"src/foo.test.ts","status":"pass"}}';
    expect(parseBunTestNdjson(ndjson)).toEqual([]);
  });

  it('skips non-JSON lines', () => {
    expect(parseBunTestNdjson('Bun v1.x\nRunning tests...\n')).toEqual([]);
  });
});

// ── parseGoTestNdjson ───────────────────────────────────────────────────────

describe('parseGoTestNdjson', () => {
  it('parses go test -json NDJSON output', () => {
    const ndjson = [
      '{"Action":"run","Package":"pkg","Test":"TestFoo"}',
      '{"Action":"output","Package":"pkg","Test":"TestFoo","Output":"--- FAIL: TestFoo\\n"}',
      '{"Action":"fail","Package":"pkg","Test":"TestFoo"}',
      '{"Action":"pass","Package":"pkg","Test":"TestBar"}',
    ].join('\n');
    const diagnostics = parseGoTestNdjson(ndjson);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].file).toBe('pkg');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].source).toBe('go');
    expect(diagnostics[0].message).toContain('TestFoo');
  });

  it('ignores non-test failures', () => {
    const ndjson = '{"Action":"fail","Package":"pkg"}';
    expect(parseGoTestNdjson(ndjson)).toEqual([]);
  });
});

// ── parseRunnerOutput dispatcher ────────────────────────────────────────────

describe('parseRunnerOutput', () => {
  it('routes jest output to parseJestJson', () => {
    const json = JSON.stringify({
      testResults: [
        {
          name: '/repo/src/foo.test.ts',
          assertionResults: [{ status: 'failed', failureMessages: ['boom'] }],
        },
      ],
    });
    const diagnostics = parseRunnerOutput(json, 'jest');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].source).toBe('jest');
  });

  it('routes eslint output to parseEslintJson', () => {
    const json = JSON.stringify([
      { filePath: 'src/app.ts', messages: [{ line: 1, message: 'err', severity: 2 }] },
    ]);
    const diagnostics = parseRunnerOutput(json, 'eslint');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].source).toBe('eslint');
  });

  it('falls back to text parsing for unknown runner', () => {
    const output = 'FAIL src/foo.test.ts\n● broken\n';
    const diagnostics = parseRunnerOutput(output, 'unknown');
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].source).toBe('jest');
  });
});

// ── parseStructuredSummary ──────────────────────────────────────────────────

describe('parseStructuredSummary', () => {
  it('returns summary from jest JSON', () => {
    const json = JSON.stringify({ numPassedTests: 3, numFailedTests: 1, numTotalTests: 4 });
    expect(parseStructuredSummary(json, 'jest')).toEqual({
      total: 4,
      passed: 3,
      failed: 1,
      skipped: 0,
    });
  });

  it('returns undefined for non-JSON runners', () => {
    expect(parseStructuredSummary('2 failed, 5 passed', 'pytest')).toBeUndefined();
  });
});

// ── parseTestSummary (text-based, unchanged) ────────────────────────────────

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

// ── parseJestOutput (text-based, unchanged) ─────────────────────────────────

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
