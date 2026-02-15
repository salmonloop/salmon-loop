import { readFile } from 'fs/promises';

const filesToCheck = [
  'src/core/context/steps/context-gather.ts',
  'src/core/context/steps/context-targets.ts',
  'src/core/context/steps/context-budget.ts',
  'src/core/grizzco/steps/shrink.ts',
];

describe('Context audit constants usage', () => {
  it('avoids hardcoded context.* action strings in audited steps', async () => {
    for (const filePath of filesToCheck) {
      const text = await readFile(filePath, 'utf-8');
      const hasHardcodedAction = /recordContextAuditEvent\(\s*'context\./.test(text);
      expect(hasHardcodedAction).toBe(false);
    }
  });

  it('avoids hardcoded phase strings in audited steps', async () => {
    for (const filePath of filesToCheck) {
      const text = await readFile(filePath, 'utf-8');
      const hasHardcodedPhase =
        /\bphase:\s*'CONTEXT_(?:GATHER|TARGETS|BUDGET)'\b/.test(text) ||
        /\bphase:\s*'SHRINK'\b/.test(text);
      expect(hasHardcodedPhase).toBe(false);
    }
  });
});
