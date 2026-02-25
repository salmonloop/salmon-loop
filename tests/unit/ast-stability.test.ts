import { AstParser } from '../../src/core/ast/parser.js';

describe('AST Parser Stability', () => {
  const testCode = `function hello() { console.log('world'); }`;

  it('should handle repeated parsing without errors', async () => {
    for (let i = 0; i < 1000; i++) {
      const result = await AstParser.parse(testCode, 'javascript');
      expect(result).toBeDefined();
      expect(result.rootNode).toBeDefined();
    }
  });

  it('should maintain parser state consistency after many parses', async () => {
    for (let i = 0; i < 500; i++) {
      await AstParser.parse(`const x${i} = ${i};`, 'javascript');
    }

    const result = await AstParser.parse(testCode, 'javascript');
    expect(result.rootNode).toBeDefined();
  });

  it('should parse JavaScript repeatedly without errors', async () => {
    for (let i = 0; i < 100; i++) {
      const result = await AstParser.parse(testCode, 'javascript');
      expect(result).toBeDefined();
      expect(result.rootNode).toBeDefined();
    }
  });

  it('should handle empty code without crashing', async () => {
    for (let i = 0; i < 100; i++) {
      const result = await AstParser.parse('', 'javascript');
      expect(result).toBeDefined();
    }
  });

  it('should handle malformed code gracefully', async () => {
    const malformedCode = 'function { { { {{{';

    for (let i = 0; i < 50; i++) {
      const result = await AstParser.parse(malformedCode, 'javascript');
      expect(result).toBeDefined();
    }
  });
});
