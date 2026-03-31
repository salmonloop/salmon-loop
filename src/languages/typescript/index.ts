import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

import { syncFs as fs } from '../../core/adapters/fs/node-fs.js';
import { LanguagePlugin } from '../../core/plugin/interface.js';
import { ErrorType } from '../../core/types/index.js';

const require = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const commonQueries = {
  definitions: `
    (function_declaration name: (identifier) @name) @def
    (method_definition name: (property_identifier) @name) @def
    (variable_declarator name: (identifier) @name) @def
    (class_declaration name: (identifier) @name) @def
    (interface_declaration name: (identifier) @name) @def
    (type_alias_declaration name: (identifier) @name) @def
  `,
  references: `
    (call_expression function: (identifier) @name) @ref
    (member_expression property: (property_identifier) @name) @ref
    (type_reference name: (identifier) @name) @ref
  `,
};

const commonDiagnostics = {
  classifyError: (output: string) => {
    const lowerOutput = output.toLowerCase();

    // Dependency error keywords
    if (
      lowerOutput.includes('dependency version mismatch') ||
      lowerOutput.includes('module not found') ||
      lowerOutput.includes('cannot find module') ||
      lowerOutput.includes('bun install')
    ) {
      return ErrorType.DEPENDENCY_ERROR;
    }

    // Compilation error keywords (Strong signals)
    if (
      lowerOutput.includes('compilation error') ||
      lowerOutput.includes('failed to compile') ||
      lowerOutput.includes('syntaxerror') ||
      lowerOutput.includes('type error') ||
      lowerOutput.includes('cannot find module') ||
      lowerOutput.includes('module not found') ||
      /TS\d{3,5}/.test(output) // TypeScript error codes
    ) {
      return ErrorType.COMPILATION;
    }

    // Test error keywords
    if (
      lowerOutput.includes('bun file tests failed in:') ||
      lowerOutput.includes('script "test:unit" exited with code') ||
      lowerOutput.includes('script "test:full" exited with code') ||
      ((lowerOutput.includes('fail') || lowerOutput.includes('failed')) &&
        (lowerOutput.includes('test suites') ||
          lowerOutput.includes('test files') ||
          lowerOutput.includes('spec'))) || // Common test framework signals
      lowerOutput.includes('assertionerror') ||
      lowerOutput.includes('expect(') ||
      lowerOutput.includes('should(') ||
      (lowerOutput.includes('failing') && lowerOutput.includes('mocha'))
    ) {
      return ErrorType.TEST;
    }

    // Lint error keywords
    if (
      lowerOutput.includes('eslint') ||
      lowerOutput.includes('prettier') ||
      lowerOutput.includes('stylelint') ||
      lowerOutput.includes('oxfmt') ||
      lowerOutput.includes('format issues found') ||
      lowerOutput.includes('script "format:check" exited with code')
    ) {
      return ErrorType.LINT;
    }

    return undefined;
  },
};

const commonDependency = {
  extractImports: (content: string) => {
    const dependencies: string[] = [];
    const importPattern =
      /(?:from\s+['"](\.\.?\/[^'"]+)['"]|require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\))/g;
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const depPath = match[1] || match[2];
      if (depPath) dependencies.push(depPath);
    }
    return dependencies;
  },
  resolvePath: (basePath: string, importPath: string) => {
    // Heuristic resolution
    if (
      !importPath.endsWith('.ts') &&
      !importPath.endsWith('.js') &&
      !importPath.endsWith('.tsx') &&
      !importPath.endsWith('.jsx')
    ) {
      // A bit naive, defaulting to .ts might not be right for .js files, but keeping simple for now
      return importPath + '.ts';
    }
    return importPath;
  },
};

function createPlugin(
  id: string,
  name: string,
  wasmLang: string,
  extensions: string[],
): LanguagePlugin {
  return {
    meta: {
      id,
      name,
      extensions,
      capabilities: {
        levels: {
          l1Parsing: true,
          l2Symbols: true,
          l3Flow: true,
        },
        ast: {
          strictValidation: true,
        },
      },
    },
    detection: {
      matches: async (repoPath: string) => {
        const packageJsonPath = path.join(repoPath, 'package.json');
        return fs.existsSync(packageJsonPath);
      },
    },
    parsing: {
      getTreeSitterWasm: async () => {
        const searchPaths = [
          path.resolve(moduleDir, '../../../bin', `tree-sitter-${wasmLang}.wasm`),
        ];

        try {
          const pkgPath = path.dirname(require.resolve(`tree-sitter-${wasmLang}/package.json`));
          searchPaths.push(path.join(pkgPath, `tree-sitter-${wasmLang}.wasm`));
        } catch (_e) {
          // ignore
        }

        for (const p of searchPaths) {
          if (fs.existsSync(p)) {
            return p;
          }
        }
        return searchPaths[0];
      },
      queries: commonQueries,
      queryPack: {
        version: '1.0.0',
        symbols: {
          calls: `
            (call_expression function: (identifier) @callee)
            (call_expression function: (member_expression property: (property_identifier) @callee))
          `,
        },
        flow: {
          control: `
            (if_statement) @branch
            (switch_statement) @branch
            (for_statement) @loop
            (for_in_statement) @loop
            (for_of_statement) @loop
            (while_statement) @loop
            (do_statement) @loop
            (await_expression) @async
          `,
          exceptions: `
            (try_statement) @trycatch
            (throw_statement) @throw
            (call_expression function: (member_expression property: (property_identifier) @catch
              (#eq? @catch "catch")))
          `,
        },
      },
    },
    dependency: commonDependency,
    diagnostics: commonDiagnostics,
  };
}

export const typescriptPlugin = createPlugin('typescript', 'TypeScript', 'typescript', [
  '.ts',
  '.mts',
  '.cts',
]);
export const tsxPlugin = createPlugin('tsx', 'TypeScript TSX', 'tsx', ['.tsx']);
export const javascriptPlugin = createPlugin('javascript', 'JavaScript', 'javascript', [
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
]);
