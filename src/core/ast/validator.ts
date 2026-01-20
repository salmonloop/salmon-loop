import * as TreeSitter from 'web-tree-sitter';

const Parser = (TreeSitter as any).Parser || TreeSitter;

export interface AstError {
  line: number;
  column: number;
  type: 'ERROR' | 'MISSING';
  text: string;
}

export function checkSyntaxErrors(tree: any): AstError[] {
  if (!tree) return [];
  const errors: AstError[] = [];
  
  let cursor;
  try {
    cursor = typeof tree.walk === 'function' ? tree.walk() : null;
  } catch (e) {
    return [];
  }
  if (!cursor) return [];

  let reachedRoot = false;
  while (!reachedRoot) {
    const node = cursor.currentNode;
    // @ts-ignore
    const isMissing = typeof node.isMissing === 'function' ? node.isMissing() : node.isMissing;
    
    if (node.type === 'ERROR' || isMissing) {
      errors.push({
        line: node.startPosition.row,
        column: node.startPosition.column,
        type: node.type === 'ERROR' ? 'ERROR' : 'MISSING',
        text: node.text,
      });
    }

    if (cursor.gotoFirstChild()) {
      continue;
    }

    if (cursor.gotoNextSibling()) {
      continue;
    }

    let retracing = true;
    while (retracing) {
      if (!cursor.gotoParent()) {
        retracing = false;
        reachedRoot = true;
      } else if (cursor.gotoNextSibling()) {
        retracing = false;
      }
    }
  }

  return errors;
}
