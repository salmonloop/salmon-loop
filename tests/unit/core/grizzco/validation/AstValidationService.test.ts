import { describe, it, expect } from 'vitest';

import {
  OpType,
  type ShadowOperation,
} from '../../../../../src/core/grizzco/domain/grizzco-types.js';
import { AstValidationService } from '../../../../../src/core/grizzco/validation/AstValidationService.js';

describe('AstValidationService', () => {
  it('returns ok when no relevant operations exist', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
      { type: OpType.DELETE, path: 'src/b.ts' },
      { type: OpType.OVERWRITE, path: 'README.md', content: Buffer.from('# hi') },
    ];

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => undefined,
      parse: async () => ({}),
      validateScopeIntegrity: () => ({ ok: true }),
      loadOriginalContent: async () => null,
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x', targetNodeName: 'T' });
    expect(result.ok).toBe(true);
  });

  it('fails when scope integrity check fails', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.OVERWRITE, path: 'src/a.ts', content: Buffer.from('const x = 1') },
    ];

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      parse: async () => ({}),
      validateScopeIntegrity: () => ({ ok: false, reason: 'removed node' }),
      loadOriginalContent: async () => 'const x = 0',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x', targetNodeName: 'T' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('AST Scope Integrity failed');
    expect(result.filePath).toBe('src/a.ts');
  });

  it('fails when proposed parsing throws', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.OVERWRITE, path: 'src/a.ts', content: Buffer.from('bad') },
    ];

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      parse: async (code) => {
        if (code === 'bad') throw new Error('parse error');
        return {};
      },
      validateScopeIntegrity: () => ({ ok: true }),
      loadOriginalContent: async () => null,
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('AST Syntax Error');
    expect(result.filePath).toBe('src/a.ts');
  });
});
