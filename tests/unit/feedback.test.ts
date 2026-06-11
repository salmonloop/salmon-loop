import { generateFeedbackPrompt } from '../../src/core/feedback/index.js';
import {
  parseTscOutput,
  parsePythonError,
  parsePytestOutput,
} from '../../src/core/feedback/parsers.js';

describe('Smart Feedback', () => {
  describe('TSC Parser', () => {
    it('should parse tsc error output', () => {
      const output =
        'src/app.ts(10,5): error TS2322: Type "string" is not assignable to type "number".';
      const diagnostics = parseTscOutput(output);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        file: 'src/app.ts',
        line: 10,
        severity: 'error',
        source: 'tsc',
      });
    });
  });

  describe('Python Parser', () => {
    it('should parse python traceback', () => {
      const output = `
File "app.py", line 10, in <module>
    print(1/0)
ZeroDivisionError: division by zero
      `.trim();
      const diagnostics = parsePythonError(output);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        file: 'app.py',
        line: 10,
        source: 'python',
      });
    });
  });

  describe('Pytest Parser', () => {
    it('should parse FAILED lines (--tb=short -q format)', () => {
      const output = `
FAILED tests/test_module.py::test_function - AssertionError: expected 5, got 3
FAILED tests/test_module.py::TestClass::test_method - ValueError: bad value
========================= 2 failed, 5 passed in 0.12s =========================
      `.trim();
      const diagnostics = parsePytestOutput(output);
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0]).toMatchObject({
        file: 'tests/test_module.py',
        severity: 'error',
        source: 'pytest',
        message: 'AssertionError: expected 5, got 3',
      });
      expect(diagnostics[1]).toMatchObject({
        file: 'tests/test_module.py',
        severity: 'error',
        source: 'pytest',
        message: 'ValueError: bad value',
      });
    });

    it('should parse --tb=line format', () => {
      const output = `
tests/test_module.py:42: AssertionError
tests/test_other.py:10: ValueError
      `.trim();
      const diagnostics = parsePytestOutput(output);
      expect(diagnostics).toHaveLength(2);
      expect(diagnostics[0]).toMatchObject({
        file: 'tests/test_module.py',
        line: 42,
        severity: 'error',
        source: 'pytest',
        message: 'AssertionError',
      });
    });

    it('should enhance FAILED with traceback file:line info', () => {
      const output = `
_____________ test_function _____________

tests/test_module.py:42: in test_function
    assert result == expected
E       AssertionError: expected 5, got 3

FAILED tests/test_module.py::test_function - AssertionError: expected 5, got 3
      `.trim();
      const diagnostics = parsePytestOutput(output);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]).toMatchObject({
        file: 'tests/test_module.py',
        line: 42,
        severity: 'error',
        source: 'pytest',
      });
    });

    it('should return empty for non-pytest output', () => {
      const output = 'Everything is fine!';
      expect(parsePytestOutput(output)).toHaveLength(0);
    });
  });

  describe('Prompt Generation', () => {
    it('should generate a structured prompt', () => {
      const diagnostics = [
        {
          file: 'test.ts',
          line: 5,
          severity: 'error' as const,
          message: 'TS2322: Error message',
          source: 'tsc',
        },
      ];
      const prompt = generateFeedbackPrompt(diagnostics);
      expect(prompt).toContain('Critical Errors found');
      expect(prompt).toContain('test.ts:5');
      expect(prompt).toContain('TS2322');
    });
  });
});
