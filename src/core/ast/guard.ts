import { text } from '../../locales/index.js';

/**
 * Get all top-level nodes from a tree
 */
export function getTopLevelNodes(tree: any): any[] {
  const nodes: any[] = [];
  if (!tree || typeof tree.walk !== 'function') {
    return nodes;
  }
  try {
    const cursor = tree.walk();
    if (cursor && cursor.gotoFirstChild()) {
      do {
        nodes.push(cursor.currentNode);
      } while (cursor.gotoNextSibling());
    }
  } catch (_error) {
    // Ignore traversal errors
  }
  return nodes;
}

/**
 * Get the name of a node (e.g., function name, class name)
 */
export function getNodeName(node: any): string | null {
  if (!node) return null;
  try {
    const directName = node.childForFieldName?.('name');
    if (directName?.text) {
      return directName.text;
    }

    const namedChildren: any[] = Array.isArray(node.namedChildren)
      ? node.namedChildren
      : Array.isArray(node.children)
        ? node.children.filter((child: any) => child?.isNamed)
        : [];

    if (node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
      const declarator = namedChildren.find((child) => child.type === 'variable_declarator');
      if (declarator) {
        const declName = declarator.childForFieldName?.('name') || declarator.child?.(0);
        return declName?.text ?? null;
      }
    }

    if (node.type === 'variable_declarator') {
      const declName = node.childForFieldName?.('name') || node.child?.(0);
      return declName?.text ?? null;
    }

    const fallback = node.child?.(1);
    return fallback?.text ?? null;
  } catch (_error) {
    return null;
  }
}

/**
 * Recursively validate that a node and its children do not contain ERROR nodes
 */
export function validateNodeStructure(node: any): boolean {
  if (!node) return true;

  // Check if current node is an error
  // Tree-sitter nodes may expose isError as a function or a property.
  const isError = typeof node.isError === 'function' ? node.isError() : node.isError;
  if (node.type === 'ERROR' || isError) {
    return false;
  }

  // Recursively check children
  if (typeof node.children !== 'undefined' && Array.isArray(node.children)) {
    for (const child of node.children) {
      if (!validateNodeStructure(child)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Validate that the patched tree maintains the integrity of the original scope,
 * except for the target node that was intended to be modified.
 */
export function validateScopeIntegrity(
  originalTree: any,
  patchedTree: any,
  targetNodeName: string,
): { ok: boolean; reason?: string } {
  if (!originalTree || !patchedTree) {
    return { ok: false, reason: text.ast.invalidTree };
  }

  // First, check for syntax errors in the patched tree
  if (!validateNodeStructure(patchedTree.rootNode)) {
    return { ok: false, reason: text.ast.invalidStructure };
  }

  const origNodes = getTopLevelNodes(originalTree);
  const patchNodes = getTopLevelNodes(patchedTree);

  const patchMap = new Map<string, any>();
  for (const node of patchNodes) {
    const name = getNodeName(node);
    if (name) {
      patchMap.set(name, node);
    }
  }

  for (const node of origNodes) {
    const name = getNodeName(node);
    if (!name) continue;

    if (name !== targetNodeName) {
      const match = patchMap.get(name);
      if (!match) {
        return { ok: false, reason: text.ast.scopeRemoved(name) };
      }
      if (match.text !== node.text) {
        return { ok: false, reason: text.ast.scopeModified(name) };
      }
    }
  }

  return { ok: true };
}
