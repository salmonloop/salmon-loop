import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Force mock BEFORE importing AstParser
vi.mock('web-tree-sitter', () => {
  return {
    default: {
      init: vi.fn().mockResolvedValue(undefined),
      Parser: vi.fn().mockImplementation(() => ({
        setLanguage: vi.fn(),
        parse: vi.fn()
      })),
      Language: {
        load: vi.fn().mockResolvedValue({})
      },
      Query: vi.fn().mockImplementation(() => ({
        captures: vi.fn().mockReturnValue([])
      }))
    },
    Parser: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue(undefined),
      setLanguage: vi.fn(),
      parse: vi.fn()
    })),
    Language: {
      load: vi.fn().mockResolvedValue({})
    },
    Query: vi.fn().mockImplementation(() => ({
      captures: vi.fn().mockReturnValue([])
    }))
  };
});

import { AstParser } from '../../src/core/ast/parser.js';

describe('AstParser Symbols', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    
    // Default mock for getLanguage to avoid loading wasm files
    vi.spyOn(AstParser, 'getLanguage').mockResolvedValue({});
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
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
      const mockQueryInstance = { 
        captures: vi.fn().mockReturnValue([mockCapture]) 
      };
      
      // Import mocked Query class to verify its usage
      const TreeSitter = await import('web-tree-sitter');
      (TreeSitter.Query as any).mockImplementationOnce(() => mockQueryInstance);
      
      const tree = { rootNode: {} };
      const defs = await AstParser.identifyDefinitions(tree, 'javascript');
      
      expect(TreeSitter.Query).toHaveBeenCalled();
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
      const mockQueryInstance = { 
        captures: vi.fn().mockReturnValue([mockCapture]) 
      };
      
      const TreeSitter = await import('web-tree-sitter');
      (TreeSitter.Query as any).mockImplementationOnce(() => mockQueryInstance);
      
      const tree = { rootNode: {} };
      const refs = await AstParser.identifyReferences(tree, 'javascript');
      
      expect(TreeSitter.Query).toHaveBeenCalled();
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
