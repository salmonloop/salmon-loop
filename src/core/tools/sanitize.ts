import { ToolSpec } from './types';

export class ToolSanitizer {
  /**
   * Validate input against the tool's input schema.
   */
  validateInput(spec: ToolSpec, input: unknown): { ok: boolean; message?: string } {
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
    return { ok: true };
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

    // 4. Secret Sanitization (Stub for now)
    // TODO: Implement secret scanning here (regex replace known patterns)

    return {
      ok: true,
      output,
      summary,
      budget: { timeoutMs: spec.defaultTimeoutMs || 0, outputBytes: sizeBytes },
    };
  }
}
