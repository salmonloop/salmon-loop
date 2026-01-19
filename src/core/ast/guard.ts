import * as TreeSitter from 'web-tree-sitter';

const Parser = (TreeSitter as any).Parser || TreeSitter;

export function getTopLevelNodes(tree: any): any[] {
  const nodes: any[] = [];
  const cursor = tree.walk();
  if (cursor.gotoFirstChild()) {
    do {
      nodes.push(cursor.currentNode);
    } while (cursor.gotoNextSibling());
  }
  return nodes;
}

export function getNodeName(node: any): string | null {
  const nameNode = node.childForFieldName('name') || node.child(1);
  return nameNode ? nameNode.text : null;
}

export function validateScopeIntegrity(
  originalTree: any,
  patchedTree: any,
  targetNodeName: string
): { ok: boolean; reason?: string } {
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
        return { ok: false, reason: `Top-level node '${name}' was removed.` };
      }
      if (match.text !== node.text) {
        return { ok: false, reason: `Top-level node '${name}' was modified but it was not the target.` };
      }
    }
  }

  return { ok: true };
}
