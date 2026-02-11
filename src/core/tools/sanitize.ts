import { ToolSpec } from './types.js';

export class ToolSanitizer {
  private redactSummary(value: string): string {
    const patterns: RegExp[] = [
      /(authorization\s*:\s*bearer\s+)[^\s'",`]+/gi,
      /(api[_-]?key\s*[:=]\s*)([^\s'",`]+|"[^"]*"|'[^']*')/gi,
      /(token\s*[:=]\s*)([^\s'",`]+|"[^"]*"|'[^']*')/gi,
      /(secret\s*[:=]\s*)([^\s'",`]+|"[^"]*"|'[^']*')/gi,
      /\bsk-[a-z0-9]{20,}\b/gi,
    ];
    let redacted = value;
    redacted = redacted.replace(patterns[0], '$1[REDACTED]');
    redacted = redacted.replace(patterns[1], '$1[REDACTED]');
    redacted = redacted.replace(patterns[2], '$1[REDACTED]');
    redacted = redacted.replace(patterns[3], '$1[REDACTED]');
    redacted = redacted.replace(patterns[4], '[REDACTED]');
    return redacted;
  }

  /**
   * Validate input against the tool's input schema.
   */
  validateInput(
    spec: ToolSpec,
    input: unknown,
  ): { ok: boolean; message?: string; value?: unknown } {
    if (!spec.inputSchema || typeof spec.inputSchema.safeParse !== 'function') {
      return {
        ok: false,
        message: `Internal Error: Tool "${spec.name}" is missing a valid inputSchema.`,
      };
    }
    const parseResult = spec.inputSchema.safeParse(input);
    if (!parseResult.success) {
      const error = parseResult.error;
      return {
        ok: false,
        message: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
      };
    }
    return { ok: true, value: parseResult.data };
  }

  /**
   * Sanitize, validate, and summarize tool output.
   */
  sanitizeOutput(
    spec: ToolSpec,
    rawOutput: unknown,
  ): {
    ok: boolean;
    output?: unknown;
    summary?: string;
    message?: string;
    budget?: { timeoutMs: number; outputBytes: number };
  } {
    // 1. Schema Validation
    if (!spec.outputSchema || typeof spec.outputSchema.safeParse !== 'function') {
      return {
        ok: false,
        message: `Internal Error: Tool "${spec.name}" is missing a valid outputSchema.`,
        budget: { timeoutMs: spec.defaultTimeoutMs || 0, outputBytes: 0 },
      };
    }
    const parseResult = spec.outputSchema.safeParse(rawOutput);
    if (!parseResult.success) {
      const error = parseResult.error;
      return {
        ok: false,
        message: `Output validation failed: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        budget: { timeoutMs: spec.defaultTimeoutMs || 0, outputBytes: 0 }, // Estimate
      };
    }

    const output = parseResult.data;

    // 2. Size Calculation & Summary Truncation
    const jsonOutput = JSON.stringify(output);
    const sizeBytes = jsonOutput.length; // Approximate

    // 3. Create Summary (Truncated)
    const MAX_SUMMARY_LEN = 1000;
    let summary = jsonOutput;
    if (summary.length > MAX_SUMMARY_LEN) {
      summary = summary.substring(0, MAX_SUMMARY_LEN) + '...[TRUNCATED]';
    }
    summary = this.redactSummary(summary);

    return {
      ok: true,
      output,
      summary,
      budget: { timeoutMs: spec.defaultTimeoutMs || 0, outputBytes: sizeBytes },
    };
  }
}
