import { afterEach, describe, expect, it, vi } from 'bun:test';

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
      supportsStrictValidation: () => true,
      buildProposedSource: async () => null,
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
  });

  it('fails when proposed parsing throws non-infra error', async () => {
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
      supportsStrictValidation: () => true,
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
      supportsStrictValidation: () => true,
      buildProposedSource: async () => 'const x = 1',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
    expect(parse).toHaveBeenCalledWith('const x = 1', 'typescript');
  });

  it('skips operation when proposed source cannot be reconstructed', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const parse = vi.fn(async () => ({}));
    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      parse,
      supportsStrictValidation: () => true,
      buildProposedSource: async () => null,
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
    expect(parse).not.toHaveBeenCalled();
  });

  it('soft-skips AST infra errors', async () => {
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
      supportsStrictValidation: () => true,
      buildProposedSource: async () => 'const x = 1;',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
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
      supportsStrictValidation: () => true,
      buildProposedSource: async () => 'const a = 1;',
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);
    expect(parseSpy).toHaveBeenCalled();
  });

  it('parses full OVERWRITE content as proposed source', async () => {
    const parseSpy = vi.fn(async (_code: string, _lang: string) => ({}));

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => [
        {
          type: OpType.OVERWRITE,
          path: 'src/new.ts',
          content: Buffer.from('export function hi() {\n  return 1;\n}\n', 'utf8'),
        },
      ],
      resolveLanguage: () => 'typescript',
      parse: parseSpy,
      supportsStrictValidation: () => true,
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x' });
    expect(result.ok).toBe(true);

    const parsedInput = String(parseSpy.mock.calls[0]?.[0] ?? '');
    expect(parsedInput).toContain('export function hi()');
  });

  it('fails in strict mode when plugin supports strict validation and source reconstruction fails', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      supportsStrictValidation: () => true,
      parse: async () => ({}),
      buildProposedSource: async () => null,
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x', strictness: 'strict' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unable to reconstruct proposed source');
  });

  it('keeps lenient behavior when plugin does not support strict validation', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const service = new AstValidationService({
      convertDiffToShadowOperations: async () => ops,
      resolveLanguage: () => 'typescript',
      supportsStrictValidation: () => false,
      parse: async () => ({}),
      buildProposedSource: async () => null,
    });

    const result = await service.validate({ workPath: '/repo', diff: 'x', strictness: 'strict' });
    expect(result.ok).toBe(true);
  });

  it('fails infra errors in strict mode only when plugin supports strict validation', async () => {
    const ops: ShadowOperation[] = [
      { type: OpType.PATCH, path: 'src/a.ts', content: Buffer.from('diff') },
    ];

    const createService = (supportsStrictValidation: boolean) =>
      new AstValidationService({
        convertDiffToShadowOperations: async () => ops,
        resolveLanguage: () => 'typescript',
        supportsStrictValidation: () => supportsStrictValidation,
        parse: async () => {
          throw new Error(
            'Failed to load language typescript: ENOENT: no such file or directory, open tree-sitter-typescript.wasm',
          );
        },
        buildProposedSource: async () => 'const x = 1;',
      });

    const strictResult = await createService(true).validate({
      workPath: '/repo',
      diff: 'x',
      strictness: 'strict',
    });
    expect(strictResult.ok).toBe(false);

    const nonStrictCapResult = await createService(false).validate({
      workPath: '/repo',
      diff: 'x',
      strictness: 'strict',
    });
    expect(nonStrictCapResult.ok).toBe(true);
  });
});
