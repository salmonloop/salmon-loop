import { afterEach, describe, it, expect, vi } from 'vitest';

import { AstParser } from '../../../../../src/core/ast/parser.js';
import {
  OpType,
  type ShadowOperation,
} from '../../../../../src/core/grizzco/domain/grizzco-types.js';
import { AstValidationService } from '../../../../../src/core/grizzco/validation/AstValidationService.js';
import { RealFsTestHelper } from '../../../../helpers/real-fs-helper.js';

describe('AstValidationService', () => {
  const helper = new RealFsTestHelper();

  afterEach(async () => {
    vi.restoreAllMocks();
    await helper.cleanup();
  });

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
      buildProposedSource: async () => null,
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
      buildProposedSource: async () => 'const x = 1',
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
      buildProposedSource: async () => 'bad',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('AST Syntax Error');
    expect(result.filePath).toBe('src/a.ts');
  });

  it('validates PATCH syntax from reconstructed source', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const parse = vi.fn(async () => ({}));
    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      parse,
      validateScopeIntegrity: () => ({ ok: true }),
      loadOriginalContent: async () => 'const x = 0',
      buildProposedSource: async () => 'const x = 1',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
    expect(parse).toHaveBeenCalledWith('const x = 1', 'typescript');
  });

  it('skips scope integrity when targetNodeName is not provided', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const validateScopeIntegrity = vi.fn(() => ({ ok: false, reason: 'removed node' }));
    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      parse: async () => ({}),
      validateScopeIntegrity,
      loadOriginalContent: async () => 'const x = 0',
      buildProposedSource: async () => 'const x = 1',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
    expect(validateScopeIntegrity).not.toHaveBeenCalled();
  });

  it('fails if targetNodeName is set but proposed source cannot be reconstructed', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      parse: async () => ({}),
      validateScopeIntegrity: () => ({ ok: true }),
      loadOriginalContent: async () => 'const x = 0',
      buildProposedSource: async () => null,
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x', targetNodeName: 'fn' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unable to reconstruct proposed source');
  });

  it('soft-skips AST infra errors when targetNodeName is not provided', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      parse: async () => {
        throw new Error(
          'Failed to load language typescript: ENOENT: no such file or directory, open tree-sitter-typescript.wasm',
        );
      },
      validateScopeIntegrity: () => ({ ok: true }),
      loadOriginalContent: async () => null,
      buildProposedSource: async () => 'const x = 1;',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
  });

  it('does not soft-skip AST infra errors when targetNodeName is provided', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      parse: async () => {
        throw new Error(
          'Failed to load language typescript: ENOENT: no such file or directory, open tree-sitter-typescript.wasm',
        );
      },
      validateScopeIntegrity: () => ({ ok: true }),
      loadOriginalContent: async () => null,
      buildProposedSource: async () => 'const x = 1;',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x', targetNodeName: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('AST Syntax Error');
  });

  it('uses AstParser.parse with correct static context in default deps', async () => {
    const parseSpy = vi.spyOn(AstParser, 'parse').mockImplementation(async function (
      this: typeof AstParser,
      _code: string,
      _lang: string,
    ): Promise<any> {
      if (this !== AstParser) {
        throw new Error('AstParser.parse called with wrong this');
      }
      return {};
    });

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => [
        { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
      ],
      resolveLanguage: () => 'typescript',
      loadOriginalContent: async () => null,
      buildProposedSource: async () => 'const a = 1;',
      validateScopeIntegrity: () => ({ ok: true }),
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
    expect(parseSpy).toHaveBeenCalled();
  });

  it('reconstructs OVERWRITE diff into full source before parsing', async () => {
    const repo = await helper.createGitRepo({
      initialFiles: [{ path: 'README.md', content: '# init\n' }],
    });

    const parseSpy = vi.fn(async (_code: string, _lang: string) => ({}));
    const overwriteDiff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export function hi() {',
      '+  return 1;',
      '+}',
      '',
    ].join('\n');

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => [
        {
          type: OpType.OVERWRITE,
          path: 'src/new.ts',
          content: Buffer.from(overwriteDiff, 'utf8'),
        },
      ],
      resolveLanguage: () => 'typescript',
      parse: parseSpy,
      loadOriginalContent: async () => null,
      validateScopeIntegrity: () => ({ ok: true }),
    });

    const result = await service.validate({ workPath: repo.path, diff: 'x' });
    expect(result.ok).toBe(true);

    const parsedInput = String(parseSpy.mock.calls[0]?.[0] ?? '');
    expect(parsedInput.startsWith('diff --git')).toBe(false);
    expect(parsedInput).toContain('export function hi()');
  });
});
