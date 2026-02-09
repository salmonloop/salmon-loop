import { describe, it, expect } from 'vitest';

import {
  ContextValidator,
  AuditEntry,
} from '../../../../../src/core/grizzco/validation/ContextValidator.js';

describe('ContextValidator', () => {
  it('should return valid if files were captured (READ intent used)', () => {
    const audit: AuditEntry[] = [
      { toolName: 'code.search', toolIntent: 'SEARCH', toolResultStatus: 'ok' },
      { toolName: 'fs.read', toolIntent: 'READ', toolResultStatus: 'ok' },
    ];
    const result = ContextValidator.validateExploration(audit, 1);
    expect(result.isValid).toBe(true);
  });

  it('should return invalid if no files were read during exploration', () => {
    const audit: AuditEntry[] = [];
    const result = ContextValidator.validateExploration(audit, 0);
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('noFilesRead');
  });

  it('should return invalid (errorCode: explorationHallucination) if search succeeded but no read occurred', () => {
    const audit: AuditEntry[] = [
      { toolName: 'code.search', toolIntent: 'SEARCH', toolResultStatus: 'ok' },
    ];
    const result = ContextValidator.validateExploration(audit, 0);

    // This is expected to FAIL because the current implementation is stubbed to return true
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('explorationHallucination');
  });

  it('should return invalid if search failed and no files were read', () => {
    const audit: AuditEntry[] = [
      { toolName: 'code.search', toolIntent: 'SEARCH', toolResultStatus: 'error' },
    ];
    const result = ContextValidator.validateExploration(audit, 0);
    expect(result.isValid).toBe(false);
    expect(result.errorCode).toBe('noFilesRead');
  });
});
