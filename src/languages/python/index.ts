import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

import { syncFs as fs } from '../../core/adapters/fs/node-fs.js';
import { LanguagePlugin } from '../../core/plugin/interface.js';
import { ErrorType } from '../../core/types/index.js';

const require = createRequire(import.meta.url);
const moduleDir = path.dirname(fileURLToPath(import.meta.url));

const queries = {
  definitions: `
    (function_definition name: (identifier) @name) @def
    (class_definition name: (identifier) @name) @def
    (decorated_definition
      definition: (function_definition name: (identifier) @name)) @def
    (decorated_definition
      definition: (class_definition name: (identifier) @name)) @def
  `,
  references: `
    (call function: (identifier) @name) @ref
    (attribute object: (identifier) @name) @ref
  `,
};

export const pythonPlugin: LanguagePlugin = {
  meta: {
    id: 'python',
    name: 'Python',
    extensions: ['.py', '.pyw', '.pyi'],
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
      const markers = ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'];
      return markers.some((m) => fs.existsSync(path.join(repoPath, m)));
    },
  },
  parsing: {
    getTreeSitterWasm: async () => {
      const searchPaths = [path.resolve(moduleDir, '../../../bin', 'tree-sitter-python.wasm')];

      try {
        const pkgPath = path.dirname(require.resolve('tree-sitter-python/package.json'));
        searchPaths.push(path.join(pkgPath, 'tree-sitter-python.wasm'));
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
    queries,
    queryPack: {
      version: '1.0.0',
      symbols: {
        calls: `
          (call function: (identifier) @callee)
          (call function: (attribute attribute: (identifier) @callee))
        `,
      },
      flow: {
        control: `
          (if_statement) @branch
          (elif_clause) @branch
          (for_statement) @loop
          (while_statement) @loop
          (await) @async
        `,
        exceptions: `
          (try_statement) @trycatch
          (raise_statement) @throw
          (except_clause) @catch
        `,
      },
    },
  },
  dependency: {
    extractImports: (content: string) => {
      const dependencies: string[] = [];
      // from .foo import bar / from ..foo import bar
      const fromPattern = /from\s+(\.\.+[.\w/]*)\s+import/g;
      // import .foo (rare but valid in some contexts)
      const importPattern = /(?:^|\s)import\s+(\.\.+[.\w/]*)/gm;

      let match;
      while ((match = fromPattern.exec(content)) !== null) {
        if (match[1]) dependencies.push(match[1]);
      }
      while ((match = importPattern.exec(content)) !== null) {
        if (match[1]) dependencies.push(match[1]);
      }
      return dependencies;
    },
    resolvePath: (_basePath: string, importPath: string) => {
      if (!importPath.endsWith('.py') && !importPath.endsWith('.pyi')) {
        return importPath + '.py';
      }
      return importPath;
    },
  },
  diagnostics: {
    classifyError: (output: string) => {
      const lower = output.toLowerCase();

      // Dependency errors
      if (
        lower.includes('modulenotfounderror') ||
        lower.includes('importerror') ||
        lower.includes('no module named') ||
        lower.includes('pip install')
      ) {
        return ErrorType.DEPENDENCY_ERROR;
      }

      // Compilation / syntax errors
      if (
        lower.includes('syntaxerror') ||
        lower.includes('indentationerror') ||
        lower.includes('taberror') ||
        lower.includes('failed to compile') ||
        lower.includes('py_compile')
      ) {
        return ErrorType.COMPILATION;
      }

      // Test errors
      if (
        lower.includes('pytest') ||
        lower.includes('unittest') ||
        lower.includes('assertionerror') ||
        lower.includes('assert ') ||
        lower.includes('test failed') ||
        lower.includes('tests failed') ||
        lower.includes('failed tests') ||
        lower.includes(' ERRORS') ||
        lower.includes(' FAILURES')
      ) {
        return ErrorType.TEST;
      }

      // Lint errors
      if (
        lower.includes('pylint') ||
        lower.includes('flake8') ||
        lower.includes('mypy') ||
        lower.includes('ruff') ||
        lower.includes('pycodestyle') ||
        lower.includes('pyflakes')
      ) {
        return ErrorType.LINT;
      }

      return undefined;
    },
  },
};
