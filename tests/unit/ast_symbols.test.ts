import { describe, it, expect, vi } from 'vitest';
import { AstParser } from '../../src/core/ast/parser.js';

describe('AstParser Symbols', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for getLanguage to avoid loading wasm files
    vi.spyOn(AstParser, 'getLanguage').mockResolvedValue({
      query: vi.fn().mockReturnValue({ captures: vi.fn().mockReturnValue([]) }),
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('identifyDefinitions', () => {
    it('should process captures into SymbolInfo', async () => {
      const mockNode = {
        text: 'hello',
        startPosition: { row: 0, column: 9 },
        endPosition: { row: 0, column: 14 },
        childForFieldName: vi.fn().mockReturnThis(),
      };
      const mockCapture = { name: 'def', node: mockNode };
      const mockQuery = { captures: vi.fn().mockReturnValue([mockCapture]) };
      const mockLanguage = { query: vi.fn().mockReturnValue(mockQuery) };
      
      vi.spyOn(AstParser, 'getLanguage').mockResolvedValue(mockLanguage);
      
      const tree = { rootNode: {} };
      const defs = await AstParser.identifyDefinitions(tree, 'javascript');
      
      expect(defs).toHaveLength(1);
      expect(defs[0]).toEqual({
        name: 'hello',
        kind: 'definition',
        location: {
          start: { line: 1, column: 9 },
          end: { line: 1, column: 14 }
        }
      });
    });

    it('should return empty array if no query for language', async () => {
      const defs = await AstParser.identifyDefinitions({}, 'unknown');
      expect(defs).toEqual([]);
    });
  });

  describe('identifyReferences', () => {
    it('should process captures into SymbolInfo', async () => {
      const mockNode = {
        text: 'world',
        startPosition: { row: 1, column: 2 },
        endPosition: { row: 1, column: 7 },
        childForFieldName: vi.fn().mockReturnThis(),
      };
      const mockCapture = { name: 'ref', node: mockNode };
      const mockQuery = { captures: vi.fn().mockReturnValue([mockCapture]) };
      const mockLanguage = { query: vi.fn().mockReturnValue(mockQuery) };
      
      vi.spyOn(AstParser, 'getLanguage').mockResolvedValue(mockLanguage);
      
      const tree = { rootNode: {} };
      const refs = await AstParser.identifyReferences(tree, 'javascript');
      
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual({
        name: 'world',
        kind: 'reference',
        location: {
          start: { line: 2, column: 2 },
          end: { line: 2, column: 7 }
        }
      });
    });
  });
});
