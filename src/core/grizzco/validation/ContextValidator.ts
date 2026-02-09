import type { ToolIntent } from '../../tools/types.js';

export interface AuditEntry {
  toolName: string;
  toolIntent?: ToolIntent;
  toolResultStatus: string;
}

export class ContextValidator {
  /**
   * Validates the consistency of the exploration phase.
   * If the model performs searches and has results, but no read actions,
   * it's identified as a potential hallucination risk.
   */
  static validateExploration(
    audit: AuditEntry[],
    capturedCount: number,
  ): { isValid: boolean; errorCode?: string } {
    if (capturedCount > 0) return { isValid: true };

    const hasSuccessfulSearch = audit.some(
      (e) => e.toolIntent === 'SEARCH' && e.toolResultStatus === 'ok',
    );

    return {
      isValid: false,
      errorCode: hasSuccessfulSearch ? 'explorationHallucination' : 'noFilesRead',
    };
  }
}
