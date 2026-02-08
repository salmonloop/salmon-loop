export interface AuditEntry {
  toolName: string;
  toolIntent?: string;
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
    const hasSuccessfulSearch = audit.some(
      (e) => e.toolIntent === 'SEARCH' && e.toolResultStatus === 'ok',
    );

    // If search was performed but no files were read, it's a hallucination
    if (hasSuccessfulSearch && capturedCount === 0) {
      return {
        isValid: false,
        errorCode: 'explorationHallucination',
      };
    }

    return { isValid: true };
  }
}
