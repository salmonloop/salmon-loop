import { vi, describe, it, expect } from 'vitest';

import { validateScopeIntegrity } from '../../src/core/ast/guard.js';
import { AstParser } from '../../src/core/ast/parser.js';
import { checkSyntaxErrors } from '../../src/core/ast/validator.js';

describe('AST Verification', () => {
  describe('AstParser Real Integration', () => {
    it('should be able to instantiate the parser', async () => {
      // This should not throw "Parser is not a constructor"
      const code = 'console.log("test")';
      await AstParser.parse(code, 'javascript');
    });

    it('should be able to parse javascript code', async () => {
      const code = 'function hello() { console.log("world"); }';
      const tree = await AstParser.parse(code, 'javascript');
      expect(tree).toBeDefined();
      expect(tree.rootNode.type).toBe('program');
    });
  });

  describe('checkSyntaxErrors', () => {
    it('should detect ERROR nodes', () => {
      const mockNode = {
        type: 'ERROR',
        isMissing: false,
        startPosition: { row: 1, column: 5 },
        text: 'some error',
      };
      const mockCursor = {
        currentNode: mockNode,
        gotoFirstChild: vi.fn().mockReturnValue(false),
        gotoNextSibling: vi.fn().mockReturnValue(false),
        gotoParent: vi.fn().mockReturnValue(false),
      };
      const mockTree = {
        walk: () => mockCursor,
      } as any;

      const errors = checkSyntaxErrors(mockTree);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        line: 1,
        type: 'ERROR',
      });
    });
  });

  describe('validateScopeIntegrity', () => {
    function createMockTree(nodes: { name: string; text: string }[]) {
      let index = -1;
      const mockCursor = {
        currentNode: null as any,
        gotoFirstChild: vi.fn().mockImplementation(() => {
          if (nodes.length > 0) {
            index = 0;
            mockCursor.currentNode = createMockNode(nodes[index]);
            return true;
          }
          return false;
        }),
        gotoNextSibling: vi.fn().mockImplementation(() => {
          index++;
          if (index < nodes.length) {
            mockCursor.currentNode = createMockNode(nodes[index]);
            return true;
          }
          return false;
        }),
      };
      return { walk: () => mockCursor };
    }

    function createMockNode(data: { name: string; text: string }) {
      return {
        text: data.text,
        childForFieldName: (name: string) => (name === 'name' ? { text: data.name } : null),
        child: (i: number) => (i === 1 ? { text: data.name } : null),
      };
    }

    it('should return ok: true if only target node is modified', () => {
      const origTree = createMockTree([
        { name: 'func1', text: 'func1() {}' },
        { name: 'func2', text: 'func2() {}' },
      ]);
      const patchTree = createMockTree([
        { name: 'func1', text: 'func1() { modified }' },
        { name: 'func2', text: 'func2() {}' },
      ]);

      const result = validateScopeIntegrity(origTree as any, patchTree as any, 'func1');
      expect(result.ok).toBe(true);
    });

    it('should return ok: false if non-target node is modified', () => {
      const origTree = createMockTree([
        { name: 'func1', text: 'func1() {}' },
        { name: 'func2', text: 'func2() {}' },
      ]);
      const patchTree = createMockTree([
        { name: 'func1', text: 'func1() { modified }' },
        { name: 'func2', text: 'func2() { illegal }' },
      ]);

      const result = validateScopeIntegrity(origTree as any, patchTree as any, 'func1');
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('func2');
    });
  });
});
