import { getLogger } from '../observability/logger.js';
import type { RunnerKind } from '../verification/detect-runner.js';

import { Diagnostic } from './types.js';

export function parseTscOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');
  // Example: src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
  const regex = /^(.+)\((\d+),(\d+)\): (error|warning) (TS\d+): (.+)$/;

  for (const line of lines) {
    const match = line.trim().match(regex);
    if (match) {
      diagnostics.push({
        file: match[1],
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        severity: match[4] as 'error' | 'warning',
        message: `${match[5]}: ${match[6]}`,
        source: 'tsc',
      });
    }
  }
  return diagnostics;
}

export function parsePythonError(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');
  // Example: File "app.py", line 10, in <module>
  const fileRegex = /File "(.+)", line (\d+)/;

  let currentFile: string | null = null;
  let currentLine: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const fileMatch = line.match(fileRegex);
    if (fileMatch) {
      currentFile = fileMatch[1];
      currentLine = parseInt(fileMatch[2]);
    } else if (currentFile && (line.includes('Error:') || line.includes('Exception:'))) {
      diagnostics.push({
        file: currentFile,
        line: currentLine || undefined,
        severity: 'error',
        message: line,
        source: 'python',
      });
      currentFile = null;
      currentLine = null;
    }
  }
  return diagnostics;
}

export function parsePytestOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');

  // Pattern 1: FAILED lines (--tb=short -q format)
  // e.g. FAILED tests/test_foo.py::test_bar - AssertionError: expected 5, got 3
  // e.g. FAILED tests/test_foo.py::TestClass::test_method - ValueError: bad value
  const failedRegex = /^FAILED\s+(\S+?)\s+-\s+(.+)$/;
  // Pattern 2: Assertion detail lines (E   prefix)
  // e.g. E       AssertionError: expected 5, got 3
  const assertionRegex = /^\s*E\s{2,}(\w+(?:Error|Exception)?):\s*(.+)$/;
  // Pattern 3: File:line reference in traceback
  // e.g. tests/test_module.py:42: in test_function
  const fileLineRegex = /^\s*(\S+\.py):(\d+): in /;
  // Pattern 4: One-line format (--tb=line)
  // e.g. tests/test_module.py:42: AssertionError
  const lineFormatRegex = /^(\S+\.py):(\d+):\s+(\w+(?:Error|Exception)?)$/;

  // Track current file context for enhancing FAILED diagnostics
  let currentFile: string | null = null;
  let currentLine: number | null = null;
  // Map test_id -> { file, line, assertion } for merging
  const assertionMap = new Map<string, { file?: string; line?: number; assertion?: string }>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Collect file:line context from tracebacks
    const fileMatch = line.match(fileLineRegex);
    if (fileMatch) {
      currentFile = fileMatch[1];
      currentLine = parseInt(fileMatch[2]);
      continue;
    }

    // Collect assertion details
    const assertionMatch = line.match(assertionRegex);
    if (assertionMatch && currentFile) {
      // Associate with the most recent file context
      const key = `${currentFile}:${currentLine}`;
      if (!assertionMap.has(key)) {
        assertionMap.set(key, {
          file: currentFile,
          line: currentLine ?? undefined,
          assertion: `${assertionMatch[1]}: ${assertionMatch[2]}`,
        });
      }
      continue;
    }

    // Parse FAILED lines — the primary signal
    const failedMatch = line.match(failedRegex);
    if (failedMatch) {
      const testId = failedMatch[1]; // e.g. tests/test_foo.py::test_bar
      const errorMessage = failedMatch[2];
      // Extract file from test_id (everything before ::)
      const testFile = testId.split('::')[0];
      diagnostics.push({
        file: testFile,
        severity: 'error',
        message: errorMessage,
        source: 'pytest',
      });
      continue;
    }

    // Parse one-line format
    const lineFormatMatch = line.match(lineFormatRegex);
    if (lineFormatMatch) {
      diagnostics.push({
        file: lineFormatMatch[1],
        line: parseInt(lineFormatMatch[2]),
        severity: 'error',
        message: lineFormatMatch[3],
        source: 'pytest',
      });
    }
  }

  // Enhance FAILED diagnostics with file:line info from tracebacks
  if (diagnostics.length > 0 && assertionMap.size > 0) {
    for (const diag of diagnostics) {
      if (diag.source === 'pytest' && !diag.line) {
        // Find matching assertion detail by file
        for (const [, info] of assertionMap) {
          if (info.file === diag.file && info.line) {
            diag.line = info.line;
            if (info.assertion && diag.message.length < info.assertion.length) {
              diag.message = info.assertion;
            }
            break;
          }
        }
      }
    }
  }

  return diagnostics;
}

export function parseJestOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split('\n');

  // Pattern 1: FAIL src/foo.test.ts
  const suiteFailRegex = /^(?:FAIL|✗|✘)\s+(\S+)$/;
  // Pattern 2: ● Test suite failed to run / ● test_name
  const bulletRegex = /^\s*●\s+(.+)$/;
  // Pattern 3: inline error: src/foo.ts:10:5 - error TS2322: ...
  const inlineRegex = /^(\S+\.tsx?):(\d+):(\d+)\s+-\s+(error|warning)\s+(.+)$/;

  let currentSuite: string | null = null;

  for (const line of lines) {
    const suiteMatch = line.match(suiteFailRegex);
    if (suiteMatch) {
      currentSuite = suiteMatch[1];
      continue;
    }

    const inlineMatch = line.match(inlineRegex);
    if (inlineMatch) {
      diagnostics.push({
        file: inlineMatch[1],
        line: parseInt(inlineMatch[2]),
        column: parseInt(inlineMatch[3]),
        severity: inlineMatch[4] as 'error' | 'warning',
        message: inlineMatch[5],
        source: 'jest',
      });
      continue;
    }

    const bulletMatch = line.match(bulletRegex);
    if (bulletMatch && currentSuite) {
      diagnostics.push({
        file: currentSuite,
        severity: 'error',
        message: bulletMatch[1],
        source: 'jest',
      });
    }
  }

  return diagnostics;
}

// ── Structured JSON parsers ──────────────────────────────────────────────────

/** Parse jest --json output (single JSON object). */
export function parseJestJson(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let parsed: JestJsonResult;
  try {
    parsed = JSON.parse(output) as JestJsonResult;
  } catch (error) {
    getLogger().debug(
      `[Parsers] Failed to parse jest JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  for (const suite of parsed.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (assertion.status === 'failed') {
        diagnostics.push({
          file: suite.name,
          severity: 'error',
          message:
            (assertion.failureMessages ?? []).join('\n') ||
            `Test failed: ${(assertion.ancestorTitles ?? []).join(' > ')} > ${assertion.fullName ?? assertion.title}`,
          source: 'jest',
        });
      }
    }
  }
  return diagnostics;
}

interface JestJsonResult {
  numPassedTests?: number;
  numFailedTests?: number;
  numTotalTests?: number;
  testResults?: Array<{
    name: string;
    assertionResults?: Array<{
      status: 'passed' | 'failed' | 'pending';
      fullName?: string;
      title?: string;
      ancestorTitles?: string[];
      failureMessages?: string[];
    }>;
  }>;
}

/** Extract test summary from jest --json output. */
export function parseJestJsonSummary(
  output: string,
): { total: number; passed: number; failed: number; skipped: number } | undefined {
  try {
    const parsed = JSON.parse(output) as JestJsonResult;
    if (typeof parsed.numTotalTests === 'number') {
      const passed = parsed.numPassedTests ?? 0;
      const failed = parsed.numFailedTests ?? 0;
      const total = parsed.numTotalTests;
      return { total, passed, failed, skipped: total - passed - failed };
    }
  } catch (error) {
    /* not JSON */
    getLogger().debug(
      `[Parsers] Failed to parse jest JSON summary: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return undefined;
}

/** Parse eslint --format json output (JSON array). */
export function parseEslintJson(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  let parsed: EslintJsonResult[];
  try {
    parsed = JSON.parse(output) as EslintJsonResult[];
  } catch (error) {
    getLogger().debug(
      `[Parsers] Failed to parse eslint JSON output: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  for (const file of parsed) {
    for (const msg of file.messages ?? []) {
      diagnostics.push({
        file: file.filePath,
        line: msg.line,
        column: msg.column,
        severity: msg.severity === 2 ? 'error' : 'warning',
        message: msg.message + (msg.ruleId ? ` (${msg.ruleId})` : ''),
        source: 'eslint',
      });
    }
  }
  return diagnostics;
}

interface EslintJsonResult {
  filePath: string;
  messages: Array<{
    line?: number;
    column?: number;
    message: string;
    severity: number; // 1=warn, 2=error
    ruleId?: string | null;
  }>;
}

/** Parse bun test --json NDJSON output. */
export function parseBunTestNdjson(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const evt = JSON.parse(trimmed) as BunTestEvent;
      if (evt.type === 'test-fail' || evt.data?.status === 'fail') {
        const data = evt.data ?? {};
        diagnostics.push({
          file: data.file ?? data.sourceFile ?? 'unknown',
          severity: 'error',
          message: data.error?.message ?? data.message ?? 'Test failed',
          source: 'bun',
        });
      }
    } catch (error) {
      /* skip non-JSON lines */
      getLogger().debug(
        `[Parsers] Failed to parse bun test NDJSON line: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return diagnostics;
}

interface BunTestEvent {
  type?: string;
  data?: {
    status?: string;
    file?: string;
    sourceFile?: string;
    message?: string;
    error?: { message?: string };
  };
}

/** Parse go test -json NDJSON output. */
export function parseGoTestNdjson(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const evt = JSON.parse(trimmed) as GoTestEvent;
      if (evt.Action === 'fail' && evt.Test) {
        diagnostics.push({
          file: evt.Package ?? 'unknown',
          severity: 'error',
          message: `Test failed: ${evt.Test}`,
          source: 'go',
        });
      }
    } catch (error) {
      /* skip non-JSON lines */
      getLogger().debug(
        `[Parsers] Failed to parse go test NDJSON line: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return diagnostics;
}

interface GoTestEvent {
  Action: string;
  Package?: string;
  Test?: string;
  Output?: string;
}

/** Dispatch to the correct structured parser based on runner type. */
export function parseRunnerOutput(output: string, runner: RunnerKind): Diagnostic[] {
  switch (runner) {
    case 'jest':
    case 'vitest':
      return parseJestJson(output);
    case 'eslint':
      return parseEslintJson(output);
    case 'bun':
      return parseBunTestNdjson(output);
    case 'go':
      return parseGoTestNdjson(output);
    case 'pytest':
    case 'tsc':
    case 'unknown':
    default:
      return parseGenericOutput(output);
  }
}

/** Extract test summary from structured JSON output when available. */
export function parseStructuredSummary(
  output: string,
  runner: RunnerKind,
): { total: number; passed: number; failed: number; skipped: number } | undefined {
  switch (runner) {
    case 'jest':
    case 'vitest':
      return parseJestJsonSummary(output);
    default:
      return undefined;
  }
}

// ── Text-based heuristic dispatcher (fallback) ──────────────────────────────

export function parseGenericOutput(output: string): Diagnostic[] {
  // Try pytest first (SWE-bench's primary test runner)
  const pytest = parsePytestOutput(output);
  if (pytest.length > 0) return pytest;

  const jest = parseJestOutput(output);
  if (jest.length > 0) return jest;

  const tsc = parseTscOutput(output);
  if (tsc.length > 0) return tsc;

  const py = parsePythonError(output);
  if (py.length > 0) return py;

  return [];
}
