import { AstParser } from '../../ast/parser.js';
import { createLanguageSupportOrchestrator } from '../../language-support/orchestrator.js';
import { tryGetPluginRegistry } from '../../plugin/registry.js';

const MAX_SKELETON_LINES = 200;

/**
 * Top-level declaration node types that should be included in the skeleton
 * even if not captured by the definitions query. This handles imports, exports,
 * and other top-level statements.
 */
const TOP_LEVEL_INCLUDE_TYPES = new Set([
  // JS/TS
  'import_statement',
  'export_statement',
  'import_declaration',
  'export_declaration',
  // Python
  'import_from_statement',
  // Rust
  'use_declaration',
  'extern_crate_declaration',
  // Go
  'import_declaration',
  'package_clause',
]);

/**
 * Extract a cross-language code skeleton using tree-sitter AST.
 *
 * For each definition (function, class, method, type, etc.), the skeleton
 * includes only the signature line — not the body. Imports and top-level
 * declarations are preserved in full.
 *
 * Falls back to undefined if tree-sitter parsing fails (e.g., no grammar
 * installed for the language). The caller should fall back to regex-based
 * outlineSource in that case.
 */
export async function extractSkeleton(
  sourceCode: string,
  lang: string,
): Promise<string | undefined> {
  const plugin =
    tryGetPluginRegistry()?.getByExtension(`.${lang}`) ?? tryGetPluginRegistry()?.getById(lang);
  if (!plugin) return undefined;

  try {
    const tree = await AstParser.parse(sourceCode, lang);
    if (!tree?.rootNode) return undefined;

    const lines = sourceCode.split('\n');
    const includeLines = new Set<number>();
    const signatureLines = new Map<number, number>(); // startRow -> signatureEndRow

    // 1. Collect definition nodes via the plugin's definitions query
    const orchestrator = createLanguageSupportOrchestrator();
    const queryStr = await orchestrator.getASTQuery(lang, 'definitions');

    if (queryStr) {
      const captures = await AstParser.queryCapturesFromQuery(tree, lang, queryStr);
      for (const capture of captures) {
        if (capture.name === 'def') {
          const sigEnd = findSignatureEnd(lines, capture.line - 1);
          signatureLines.set(capture.line - 1, sigEnd);
        }
      }
    }

    // 2. Walk top-level nodes for imports and declarations not caught by the query
    for (const child of tree.rootNode.children ?? []) {
      const nodeType = child.type;
      const startRow = child.startPosition.row;

      if (TOP_LEVEL_INCLUDE_TYPES.has(nodeType)) {
        // Include import/export lines in full
        for (let r = child.startPosition.row; r <= child.endPosition.row; r++) {
          includeLines.add(r);
        }
      } else if (signatureLines.has(startRow)) {
        // Already captured by definitions query — include signature only
        // (handled below)
      } else if (isLikelyDeclaration(nodeType)) {
        // Top-level declaration not caught by definitions query
        const sigEnd = findSignatureEnd(lines, startRow);
        signatureLines.set(startRow, sigEnd);
      }
    }

    // 3. Also handle nested definitions (class methods, etc.)
    collectNestedDefinitions(tree.rootNode, lines, signatureLines, 0);

    // 4. Build the skeleton
    const out: string[] = [];
    const includedRows = new Set<number>();

    // First pass: include full import/export lines
    for (const row of includeLines) {
      if (out.length >= MAX_SKELETON_LINES) break;
      if (!includedRows.has(row)) {
        out.push(lines[row]);
        includedRows.add(row);
      }
    }

    // Second pass: include signature lines from definitions
    const sortedSigs = [...signatureLines.entries()].sort((a, b) => a[0] - b[0]);
    for (const [startRow, sigEndRow] of sortedSigs) {
      if (out.length >= MAX_SKELETON_LINES) break;
      for (let r = startRow; r <= sigEndRow; r++) {
        if (out.length >= MAX_SKELETON_LINES) break;
        if (!includedRows.has(r)) {
          out.push(lines[r]);
          includedRows.add(r);
        }
      }
    }

    const result = out.join('\n').trim();
    return result.length > 0 ? result : undefined;
  } catch {
    // Tree-sitter parsing failed (no grammar, parse error, etc.)
    return undefined;
  }
}

/**
 * Recursively collect nested definitions (e.g., class methods) that may not
 * be captured by the top-level definitions query.
 */
function collectNestedDefinitions(
  node: any,
  lines: string[],
  signatureLines: Map<number, number>,
  depth: number,
): void {
  if (depth > 3) return; // Prevent deep recursion

  for (const child of node.children ?? []) {
    const startRow = child.startPosition.row;

    if (isDefinitionNode(child.type) && !signatureLines.has(startRow)) {
      const sigEnd = findSignatureEnd(lines, startRow);
      signatureLines.set(startRow, sigEnd);
    }

    // Recurse into class/struct/impl bodies to find methods
    if (isContainerNode(child.type)) {
      collectNestedDefinitions(child, lines, signatureLines, depth + 1);
    }
  }
}

/**
 * Find the last line of a definition's signature (before the body starts).
 * For single-line definitions, returns startRow.
 * For multi-line definitions, returns the line containing the body-starting token.
 */
function findSignatureEnd(lines: string[], startRow: number): number {
  // Look up to 10 lines ahead for the body start
  const maxLook = Math.min(startRow + 10, lines.length - 1);

  for (let r = startRow; r <= maxLook; r++) {
    const line = lines[r];

    // C-family: body starts with '{'
    if (line.includes('{')) return r;

    // Python: body starts with ':'
    // Heuristic: the colon is at the end of a def/class/if/for/while line
    if (/:\s*$/.test(line) && r > startRow) return r;
    // Single-line Python def: def foo(): pass
    if (/:\s+\S/.test(line) && r === startRow) return r;

    // Rust: body starts with '{' or 'where' clause
    if (line.includes('{')) return r;
  }

  // Fallback: just the first line
  return startRow;
}

/**
 * Check if a node type is a definition-like node that should appear in skeleton.
 */
function isDefinitionNode(type: string): boolean {
  return (
    type.includes('function') ||
    type.includes('method') ||
    type.includes('class') ||
    type.includes('interface') ||
    type.includes('type_alias') ||
    type.includes('type_definition') ||
    type.includes('enum') ||
    type.includes('struct') ||
    type.includes('impl') ||
    type.includes('trait') ||
    type.includes('module') ||
    type.includes('namespace') ||
    type === 'decorated_definition' ||
    type === 'function_definition' ||
    type === 'async_function_definition' ||
    type === 'class_definition'
  );
}

/**
 * Check if a node type is a container that may hold nested definitions.
 */
function isContainerNode(type: string): boolean {
  return (
    type.includes('class_body') ||
    type.includes('interface_body') ||
    type.includes('struct_body') ||
    type.includes('impl_body') ||
    type.includes('declaration_list') ||
    type === 'block' ||
    type === 'statement_block' ||
    type === 'class_definition' ||
    type === 'impl_item'
  );
}

/**
 * Check if a top-level node type looks like a declaration worth including.
 */
function isLikelyDeclaration(type: string): boolean {
  return (
    type.includes('declaration') ||
    type.includes('definition') ||
    type.includes('variable') ||
    type.includes('const') ||
    type.includes('let') ||
    type.includes('type_alias') ||
    type.includes('struct') ||
    type.includes('enum') ||
    type.includes('trait') ||
    type.includes('impl')
  );
}

/**
 * Detect the tree-sitter language ID from a file path.
 * Returns undefined if no matching plugin is found.
 */
export function detectLang(filePath: string): string | undefined {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex < 0) return undefined;
  const ext = filePath.slice(dotIndex).toLowerCase();
  const plugin = tryGetPluginRegistry()?.getByExtension(ext);
  return plugin?.meta.id;
}
