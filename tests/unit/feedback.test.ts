import { describe, it, expect } from 'vitest';
import { parseTscOutput, parsePythonError } from '../../src/core/feedback/parsers.js';
import { generateFeedbackPrompt } from '../../src/core/feedback/index.js';

describe('Smart Feedback', () => {
  describe('TSC Parser', () => {
    it('should parse tsc error output', () => {
      const output = 'src/app.ts(10,5): error TS2322: Type "string" is not assignable to type "number".';
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
