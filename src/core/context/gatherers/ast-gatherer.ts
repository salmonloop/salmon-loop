import path from 'path';

import { AstParser } from '../../ast/parser.js';
import { logger } from '../../logger.js';
import type { CodeLocation, SymbolInfo } from '../../types.js';

export interface AstResult {
  symbols: SymbolInfo[];
  definitionMap: Record<string, CodeLocation>;
}

function getLanguageFromFile(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
      return 'typescript';
    case '.tsx':
      return 'tsx';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.java':
      return 'java';
    case '.cpp':
    case '.cc':
    case '.h':
      return 'cpp';
    case '.c':
      return 'c';
    default:
      return undefined;
  }
}

export class AstGatherer {
  async gather(
    primaryText: string | undefined,
    primaryFile: string | undefined,
  ): Promise<AstResult> {
    if (!primaryText || !primaryFile) {
      return { symbols: [], definitionMap: {} };
    }

    try {
      const lang = getLanguageFromFile(primaryFile);
      if (!lang) return { symbols: [], definitionMap: {} };

      const tree = await AstParser.parse(primaryText, lang);
      const defs = await AstParser.identifyDefinitions(tree, lang);
      const refs = await AstParser.identifyReferences(tree, lang);

      const definitionMap: Record<string, CodeLocation> = {};
      for (const def of defs) {
        definitionMap[def.name] = def.location;
      }

      return { symbols: [...defs, ...refs], definitionMap };
    } catch (e) {
      logger.warn(`  [CONTEXT] AST analysis failed for ${primaryFile}: ${e}`);
      return { symbols: [], definitionMap: {} };
    }
  }
}
