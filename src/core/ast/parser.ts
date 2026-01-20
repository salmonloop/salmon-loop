import * as TreeSitter from 'web-tree-sitter';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { SymbolInfo } from '../types.js';

const require = createRequire(import.meta.url);

export class AstParser {
  private static initPromise: Promise<void> | null = null;

  private static getParserClass() {
    return (TreeSitter as any).Parser || (TreeSitter as any).default?.Parser || TreeSitter;
  }

  private static getLanguageClass() {
    return (TreeSitter as any).Language || (TreeSitter as any).default?.Language;
  }

  private static getQueryClass() {
    return (TreeSitter as any).Query || (TreeSitter as any).default?.Query;
  }
  private static languages: Map<string, any> = new Map();
  private static languagePromises: Map<string, Promise<any>> = new Map();
  private static treeCache: Map<string, { tree: any; timestamp: number }> = new Map();
  private static readonly CACHE_LIMIT = 50;

  static async init() {
    if (!this.initPromise) {
      this.initPromise = this.getParserClass().init();
    }
    return this.initPromise;
  }

  static async getLanguage(lang: string, wasmPath?: string): Promise<any> {
    await this.init();
    
    if (this.languages.has(lang)) {
      return this.languages.get(lang)!;
    }

    if (this.languagePromises.has(lang)) {
      return this.languagePromises.get(lang)!;
    }

    const promise = (async () => {
      let finalWasmPath = wasmPath;

      if (!finalWasmPath) {
        const searchPaths = [
          path.join(process.cwd(), 'bin', `tree-sitter-${lang}.wasm`),
        ];

        // Try to resolve via node_modules
        try {
          const pkgPath = path.dirname(require.resolve(`tree-sitter-${lang}/package.json`));
          searchPaths.push(path.join(pkgPath, `tree-sitter-${lang}.wasm`));
        } catch (__e) {
          // Ignore resolution errors
        }

        for (const p of searchPaths) {
          if (fs.existsSync(p)) {
            finalWasmPath = p;
            break;
          }
        }

        if (!finalWasmPath) {
          finalWasmPath = searchPaths[0];
        }
      }

      const langObj = await this.getLanguageClass().load(finalWasmPath);
      this.languages.set(lang, langObj);
      return langObj;
    })();

    this.languagePromises.set(lang, promise);
    return promise;
  }

  static async parse(code: string, lang: string, wasmPath?: string): Promise<any> {
    const cacheKey = `${lang}:${code.length}:${code.substring(0, 100)}`;
    const cached = this.treeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.tree;
    }

    await this.init();
    const parser = new (this.getParserClass())();
    const language = await this.getLanguage(lang, wasmPath);
    parser.setLanguage(language);
    const tree = parser.parse(code);

    // Simple LRU-like cleanup
    if (this.treeCache.size >= this.CACHE_LIMIT) {
      const oldestKey = this.treeCache.keys().next().value;
      if (oldestKey) this.treeCache.delete(oldestKey);
    }
    this.treeCache.set(cacheKey, { tree, timestamp: Date.now() });

    return tree;
  }

  static async identifyDefinitions(tree: any, lang: string): Promise<SymbolInfo[]> {
    const language = await this.getLanguage(lang);
    let queryStr = '';

    if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript') {
      queryStr = `
        (function_declaration name: (identifier) @name) @def
        (method_definition name: (property_identifier) @name) @def
        (variable_declarator name: (identifier) @name) @def
        (class_declaration name: (identifier) @name) @def
      `;
      
      if (lang !== 'javascript') {
        queryStr += `
          (interface_declaration name: (identifier) @name) @def
          (type_alias_declaration name: (identifier) @name) @def
        `;
      }
    }

    if (!queryStr || !tree?.rootNode) return [];

    try {
      const query = new (this.getQueryClass())(language, queryStr);
      const captures = query.captures(tree.rootNode);

      return captures
        .filter((c: any) => c.name === 'def')
        .map((c: any) => {
          const nameNode = c.node.childForFieldName('name') || c.node;
          return {
            name: nameNode?.text || 'unknown',
            kind: 'definition' as const,
            location: {
              start: { line: nodeToRow(c.node.startPosition), column: c.node.startPosition.column },
              end: { line: nodeToRow(c.node.endPosition), column: c.node.endPosition.column },
            },
          };
        });
    } catch (e) {
      console.error(`AST identifyDefinitions failed: ${e}`);
      return [];
    }
  }

  static async identifyReferences(tree: any, lang: string): Promise<SymbolInfo[]> {
    const language = await this.getLanguage(lang);
    let queryStr = '';

    if (lang === 'typescript' || lang === 'tsx' || lang === 'javascript') {
      queryStr = `
        (call_expression function: (identifier) @name) @ref
        (member_expression property: (property_identifier) @name) @ref
      `;
      
      if (lang !== 'javascript') {
        queryStr += `
          (type_reference name: (identifier) @name) @ref
        `;
      }
    }

    if (!queryStr || !tree?.rootNode) return [];

    try {
      const query = new (this.getQueryClass())(language, queryStr);
      const captures = query.captures(tree.rootNode);

      return captures
        .filter((c: any) => c.name === 'ref')
        .map((c: any) => {
          const nameNode = c.node.childForFieldName('name') || c.node.childForFieldName('property') || c.node;
          return {
            name: nameNode?.text || 'unknown',
            kind: 'reference' as const,
            location: {
              start: { line: nodeToRow(c.node.startPosition), column: c.node.startPosition.column },
              end: { line: nodeToRow(c.node.endPosition), column: c.node.endPosition.column },
            },
          };
        });
    } catch (e) {
      console.error(`AST identifyReferences failed: ${e}`);
      return [];
    }
  }
}

function nodeToRow(pos: { row: number }): number {
  return pos.row + 1; // Convert 0-based to 1-based
}
