import * as TreeSitter from 'web-tree-sitter';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Handle ESM/CJS compatibility for web-tree-sitter
const Parser = (TreeSitter as any).Parser || TreeSitter;
const Language = (TreeSitter as any).Language;

export class AstParser {
  private static initPromise: Promise<void> | null = null;
  private static languages: Map<string, any> = new Map();
  private static languagePromises: Map<string, Promise<any>> = new Map();

  static async init() {
    if (!this.initPromise) {
      this.initPromise = Parser.init();
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

      const langObj = await Language.load(finalWasmPath);
      this.languages.set(lang, langObj);
      return langObj;
    })();

    this.languagePromises.set(lang, promise);
    return promise;
  }

  static async parse(code: string, lang: string, wasmPath?: string): Promise<any> {
    await this.init();
    const parser = new Parser();
    const language = await this.getLanguage(lang, wasmPath);
    parser.setLanguage(language);
    return parser.parse(code);
  }
}
