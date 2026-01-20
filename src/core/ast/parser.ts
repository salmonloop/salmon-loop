import * as TreeSitter from 'web-tree-sitter';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { SymbolInfo } from '../types.js';
import { logger } from '../logger.js';
import { text } from '../../locales/index.js';

const require = createRequire(import.meta.url);

/**
 * Initialization states for the AST parser
 */
enum InitState {
  Idle,
  Initializing,
  Ready,
  Error
}

export class AstParser {
  private static state = InitState.Idle;
  private static initPromise: Promise<void> | null = null;

  /**
   * Get the Parser class from web-tree-sitter, handling different API versions
   */
  private static getParserClass() {
    try {
      return (TreeSitter as any).Parser || (TreeSitter as any).default?.Parser || TreeSitter;
    } catch (e) {
      logger.degrade(text.ast.degradedApi);
      return (TreeSitter as any).default || TreeSitter;
    }
  }

  /**
   * Get the Language class from web-tree-sitter, handling different API versions
   */
  private static getLanguageClass() {
    try {
      return (TreeSitter as any).Language || (TreeSitter as any).default?.Language;
    } catch (e) {
      logger.degrade(text.ast.degradedApi);
      return (TreeSitter as any).default?.Language;
    }
  }

  /**
   * Get the Query class from web-tree-sitter, handling different API versions
   */
  private static getQueryClass() {
    try {
      return (TreeSitter as any).Query || (TreeSitter as any).default?.Query;
    } catch (e) {
      logger.degrade(text.ast.degradedApi);
      return (TreeSitter as any).default?.Query;
    }
  }

  private static languages: Map<string, any> = new Map();
  private static languagePromises: Map<string, Promise<any>> = new Map();
  private static treeCache: Map<string, { tree: any; timestamp: number }> = new Map();
  private static readonly CACHE_LIMIT = 50;

  /**
   * Initialize the tree-sitter WASM environment with a state machine and lock
   */
  static async init() {
    if (this.state === InitState.Ready) return;
    if (this.state === InitState.Initializing) return this.initPromise!;

    this.state = InitState.Initializing;
    this.initPromise = (async () => {
      try {
        const Parser = this.getParserClass();
        if (typeof Parser.init === 'function') {
          await Parser.init();
        }
        this.state = InitState.Ready;
      } catch (e) {
        this.state = InitState.Error;
        this.initPromise = null;
        throw new Error(text.ast.initFailed(e instanceof Error ? e.message : String(e)));
      }
    })();

    return this.initPromise;
  }

  /**
   * Load a language WASM module
   */
  static async getLanguage(lang: string, wasmPath?: string): Promise<any> {
    await this.init();
    
    if (this.languages.has(lang)) {
      return this.languages.get(lang)!;
    }

    if (this.languagePromises.has(lang)) {
      return this.languagePromises.get(lang)!;
    }

    const promise = (async () => {
      try {
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

        const Language = this.getLanguageClass();
        const langObj = await Language.load(finalWasmPath);
        this.languages.set(lang, langObj);
        return langObj;
      } catch (e) {
        throw new Error(text.ast.loadLanguageFailed(lang, e instanceof Error ? e.message : String(e)));
      }
    })();

    this.languagePromises.set(lang, promise);
    return promise;
  }

  /**
   * Parse code into an AST tree
   */
  static async parse(code: string, lang: string, wasmPath?: string): Promise<any> {
    const cacheKey = `${lang}:${code.length}:${code.substring(0, 100)}`;
    const cached = this.treeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.tree;
    }

    await this.init();
    try {
      const Parser = this.getParserClass();
      const parser = new Parser();
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
    } catch (e) {
      logger.error(`AST parse failed: ${e}`);
      throw e;
    }
  }

  /**
   * Identify definitions in the tree using queries
   */
  static async identifyDefinitions(tree: any, lang: string): Promise<SymbolInfo[]> {
    try {
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

      const Query = this.getQueryClass();
      const query = new Query(language, queryStr);
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
      logger.error(`AST identifyDefinitions failed: ${e}`);
      return [];
    }
  }

  /**
   * Identify references in the tree using queries
   */
  static async identifyReferences(tree: any, lang: string): Promise<SymbolInfo[]> {
    try {
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

      const Query = this.getQueryClass();
      const query = new Query(language, queryStr);
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
      logger.error(`AST identifyReferences failed: ${e}`);
      return [];
    }
  }
}

/**
 * Convert 0-based row to 1-based line number
 */
function nodeToRow(pos: { row: number }): number {
  return pos.row + 1;
}
