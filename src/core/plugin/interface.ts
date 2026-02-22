import { ErrorType } from '../types/index.js';

/**
 * The standard contract that all language plugins must implement.
 */
export interface LanguagePlugin {
  // Metadata
  meta: {
    id: string; // e.g., 'typescript', 'python'
    name: string; // e.g., 'TypeScript/JavaScript'
    extensions: string[]; // e.g., ['.ts', '.tsx', '.js']
  };

  // Capability 1: Detection
  detection: {
    matches: (repoPath: string) => Promise<boolean>;
    /**
     * Deprecated: verification command resolution is now handled by runtime detectors
     * that inspect the target repository environment (package manager, scripts, etc.).
     */
    getVerifyCommand?: (repoPath: string) => Promise<string | undefined>;
  };

  // Capability 2: AST Parsing
  parsing: {
    // Return path to .wasm file or the buffer itself
    getTreeSitterWasm: () => Promise<string | Uint8Array>;
    queries: {
      definitions: string; // Tree-sitter query string
      references: string;
    };
  };

  // Capability 3: Dependency Analysis
  dependency: {
    extractImports: (content: string) => string[];
    // Optional: Plugin might not support complex resolution yet
    resolvePath?: (basePath: string, importPath: string) => string | undefined;
  };

  // Capability 4: Error Analysis
  diagnostics: {
    classifyError: (log: string) => ErrorType | undefined;
  };
}
