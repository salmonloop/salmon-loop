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
    if (capturedCount === 0) {
      const highRiskTools = ['grep', 'rg', 'code-search', 'ast-grep'];
      const hasSuccessfulSearch = audit.some(
        (e) =>
          (e.toolIntent === 'SEARCH' || highRiskTools.includes(e.toolName)) &&
          e.toolResultStatus === 'ok',
      );

      return {
        isValid: false,
        errorCode: hasSuccessfulSearch ? 'explorationHallucination' : 'noFilesRead',
      };
    }

    const highRiskTools = ['grep', 'rg', 'code-search', 'ast-grep'];
    const hasSuccessfulSearch = audit.some(
      (e) =>
        (e.toolIntent === 'SEARCH' || highRiskTools.includes(e.toolName)) &&
        e.toolResultStatus === 'ok',
    );

    // Defensive check: should already be handled above, kept for clarity.
    if (hasSuccessfulSearch && capturedCount === 0) {
      return {
        isValid: false,
        errorCode: 'explorationHallucination',
      };
    }

    return { isValid: true };
  }
}
