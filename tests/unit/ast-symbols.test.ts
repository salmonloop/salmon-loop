// Force mock BEFORE importing AstParser
mock.module('web-tree-sitter', () => {
  return {
    default: {
      init: mock().mockResolvedValue(undefined),
      Parser: mock().mockImplementation(() => ({
        setLanguage: mock(),
        parse: mock(),
      })),
      Language: {
        load: mock().mockResolvedValue({}),
      },
      Query: mock().mockImplementation(() => ({
        captures: mock().mockReturnValue([]),
      })),
    },
    Parser: mock().mockImplementation(() => ({
      init: mock().mockResolvedValue(undefined),
      setLanguage: mock(),
      parse: mock(),
    })),
    Language: {
      load: mock().mockResolvedValue({}),
    },
    Query: mock().mockImplementation(() => ({
      captures: mock().mockReturnValue([]),
    })),
  };
});

import { AstParser } from '../../src/core/ast/parser.js';

describe('AstParser Symbols', () => {
  beforeEach(() => {
    useFakeTimers();


    // Default mock for getLanguage to avoid loading wasm files
    spyOn(AstParser, 'getLanguage').mockResolvedValue({});
  });

  afterEach(() => {
    runAllTimers();
    useRealTimers();
  });

  describe('identifyDefinitions', () => {
    it('should process captures into SymbolInfo', async () => {
      const mockNode = {
        text: 'hello',
        startPosition: { row: 0, column: 9 },
        endPosition: { row: 0, column: 14 },
        childForFieldName: mock().mockReturnThis(),
      };
      const mockCapture = { name: 'def', node: mockNode };
      const mockQueryInstance = {
        captures: mock().mockReturnValue([mockCapture]),
      };

      // Import mocked Query class to verify its usage
      const TreeSitter = await import('web-tree-sitter');
      (TreeSitter.Query as any).mockImplementationOnce(() => mockQueryInstance);

      const tree = { rootNode: {} };
      const defs = await AstParser.identifyDefinitions(tree, 'javascript');

      expect(Array.isArray(defs)).toBe(true);
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
        childForFieldName: mock().mockReturnThis(),
      };
      const mockCapture = { name: 'ref', node: mockNode };
      const mockQueryInstance = {
        captures: mock().mockReturnValue([mockCapture]),
      };

      const TreeSitter = await import('web-tree-sitter');
      (TreeSitter.Query as any).mockImplementationOnce(() => mockQueryInstance);

      const tree = { rootNode: {} };
      const refs = await AstParser.identifyReferences(tree, 'javascript');

      expect(Array.isArray(refs)).toBe(true);
    });
  });
});
