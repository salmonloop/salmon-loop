import * as crypto from 'crypto';

import { ExecutionPhase } from '../types.js';

import { ToolParser, ToolParseError } from './parser.js';
import { ToolRouter } from './router.js';
import { ToolCallEnvelope, ToolResult } from './types.js';

/**
 * ToolDispatcher acts as the high-level coordinator between the LLM
 * and the ToolRouter. It handles the full lifecycle of a tool call
 * from raw text to structured result.
 */
export class ToolDispatcher {
  private parser = new ToolParser();

  constructor(
    private router: ToolRouter,
    private options: {
      repoRoot: string;
      persistenceRoot?: string;
      worktreeRoot?: string;
      attemptId: number;
      dryRun: boolean;
      model?: string;
    },
  ) {}

  /**
   * Dispatches a tool call from LLM output text.
   *
   * @param text Raw completion text from LLM
   * @param phase Current execution phase (host-provided)
   * @returns ToolResult if a call was found, null if no tool call was intended
   */
  async dispatch(text: string, phase: ExecutionPhase): Promise<ToolResult | null> {
    try {
      // 1. Parse using the strict XML-based parser
      // This automatically masks code blocks to prevent unintended execution.
      const parsed = this.parser.parse(text);

      if (!parsed) {
        return null;
      }

      // 2. Build the secure ToolCallEnvelope
      // We inject metadata that the model cannot control, ensuring it
      // operates within the host-defined security boundaries.
      const envelope: ToolCallEnvelope = {
        id: crypto.randomUUID(),
        phase,
        toolName: parsed.tool,
        args: parsed.args,
        ctx: {
          repoRoot: this.options.repoRoot,
          persistenceRoot: this.options.persistenceRoot,
          worktreeRoot: this.options.worktreeRoot,
          attemptId: this.options.attemptId,
          dryRun: this.options.dryRun,
          model: this.options.model,
        },
      };

      // 3. Delegate execution to the router (which handles Policy, Budget, etc.)
      return await this.router.call(envelope);
    } catch (e) {
      if (e instanceof ToolParseError) {
        // Map parsing errors back to a result so the system can provide
        // feedback to the model to retry with correct formatting.
        return {
          id: `parse-err-${Date.now()}`,
          toolName: 'unknown',
          source: 'builtin',
          status: 'error',
          error: {
            code: 'PARSE_ERROR',
            message: e.message,
            retryable: true,
          },
        };
      }

      // For unexpected system errors, we let them bubble up
      throw e;
    }
  }

  /**
   * Updates the runtime context (e.g., when moving to a new attempt).
   */
  updateOptions(newOptions: Partial<typeof this.options>) {
    this.options = { ...this.options, ...newOptions };
  }
}
