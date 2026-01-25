import { SalmonError } from '../types';

export interface ParsedToolCall {
  tool: string;
  args: unknown;
}

/**
 * Custom error for tool parsing failures.
 */
export class ToolParseError extends SalmonError {
  constructor(message: string) {
    super(message, 'TOOL_PARSE_ERROR');
  }
}

/**
 * Strict parser for SalmonLoop Tool Calling Specification v1.1.
 *
 * Design Goals:
 * 1. Prevent "Confused Deputy" by ignoring Markdown code blocks.
 * 2. Reject ambiguous or multiple tool calls in a single turn.
 * 3. Enforce strict XML tag structure.
 */
export class ToolParser {
  /**
   * Parses a model's response text for a tool call.
   *
   * @param text The raw response from the LLM.
   * @returns The parsed tool call, or null if no tool call is found.
   * @throws ToolParseError if the call is malformed or ambiguous.
   */
  public parse(text: string): ParsedToolCall | null {
    if (!text) return null;

    // 1. Mask markdown code blocks to prevent executing example code
    const sanitizedText = this.maskCodeBlocks(text);

    // 2. Security Check: Detect legacy or unauthorized protocols
    // We strictly ban Claude's <call:tool_name> format to prevent protocol drift.
    if (/<call:[a-zA-Z0-9_.-]+/.test(sanitizedText)) {
      throw new ToolParseError(
        'Protocol Violation: Legacy <call:...> format is strictly forbidden. Use <sl_tool_call v="1">.',
      );
    }

    // 3. Extract <sl_tool_call v="1"> tags
    // We use a global match to detect multiple tags (ambiguity)
    const tagRegex = /<sl_tool_call\s+v="1">([\s\S]*?)<\/sl_tool_call>/g;
    const matches = Array.from(sanitizedText.matchAll(tagRegex));

    if (matches.length === 0) {
      // Basic check: did the model forget the tags but put JSON there?
      // Or did it use backticks instead of tags?
      // Specification v1.1 requires strict tags, so we don't try to "fix" it here.
      return null;
    }

    if (matches.length > 1) {
      throw new ToolParseError(
        'Ambiguous tool call: Multiple <sl_tool_call> tags detected outside of code blocks.',
      );
    }

    const rawJson = matches[0][1].trim();
    if (!rawJson) {
      throw new ToolParseError('Empty tool call: <sl_tool_call> tag contains no content.');
    }

    // 4. Parse JSON content
    try {
      const parsed = JSON.parse(rawJson);

      // Validation of the envelope structure
      if (!parsed.toolName || typeof parsed.toolName !== 'string') {
        throw new ToolParseError(
          'Invalid tool call structure: "toolName" field is missing or not a string.',
        );
      }

      // Map 'toolName' (protocol v1) to 'tool' (internal)
      const tool = parsed.toolName;

      if (parsed.args === undefined) {
        throw new ToolParseError('Invalid tool call structure: "args" field is missing.');
      }

      return {
        tool,
        args: parsed.args,
      };
    } catch (e) {
      if (e instanceof ToolParseError) throw e;
      throw new ToolParseError(`Failed to parse tool call JSON: ${(e as Error).message}`);
    }
  }

  /**
   * Replaces the content of Markdown code blocks with whitespace of equal length.
   * This ensures regex matches for tags won't trigger inside code blocks,
   * while preserving character offsets if we ever need them for errors.
   */
  private maskCodeBlocks(text: string): string {
    // Fenced code blocks
    let masked = text.replace(/```[\s\S]*?```/g, (match) => ' '.repeat(match.length));

    // Inline code blocks (single backticks) - also mask these just in case
    masked = masked.replace(/`[^`\n]+`/g, (match) => ' '.repeat(match.length));

    return masked;
  }
}
