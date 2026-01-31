# Language Plugins

Salmon-Loop uses a pluggable architecture to support different programming languages. While TypeScript and JavaScript support is built-in, you can easily extend Salmon-Loop to support other languages like Python, Go, Rust, or even custom DSLs without modifying the core codebase.

## How it Works

When Salmon-Loop starts (in `run` or `chat` mode), it scans two locations for language plugins:

1.  **Built-in Plugins**: Pre-packaged support (currently TypeScript/JavaScript).
2.  **User Plugins**: Custom plugins located in your project's `.salmonloop/languages/` directory.

Plugins are loaded dynamically. If a user plugin shares the same ID as a built-in one, the user plugin takes precedence, allowing you to override or enhance built-in behavior.

## Creating a User Plugin

To add support for a new language, create a directory structure like this in your project root:

```text
.salmonloop/
  languages/
    my-lang/
      index.js       # The plugin entry point (ES Module)
      parser.wasm    # (Optional) Tree-sitter WASM file
```

### Plugin Interface

Your `index.js` must export a default object conforming to the `LanguagePlugin` interface.

```javascript
// .salmonloop/languages/python/index.js

export default {
  meta: {
    id: 'python',
    name: 'Python Support',
    extensions: ['.py']
  },

  // 1. Detection & Verification
  detection: {
    // Return true if this repository is a Python project
    matches: async (repoPath) => {
      // e.g. check for requirements.txt
      return fs.existsSync(path.join(repoPath, 'requirements.txt'));
    },
    // Return the default verification command
    getVerifyCommand: async (repoPath) => {
      return 'pytest';
    }
  },

  // 2. AST Parsing (using Tree-sitter)
  parsing: {
    getTreeSitterWasm: async () => {
      // Return absolute path to your .wasm file
      return path.join(__dirname, 'tree-sitter-python.wasm');
    },
    queries: {
      // Tree-sitter query to find function/class definitions
      definitions: `
        (function_definition name: (identifier) @name) @def
        (class_definition name: (identifier) @name) @def
      `,
      // Tree-sitter query to find references/calls
      references: `
        (call function: (identifier) @name) @ref
      `
    }
  },

  // 3. Dependency Analysis
  dependency: {
    extractImports: (content) => {
      // Return list of imported file paths
      // e.g. Regex to match "import foo" or "from foo import bar"
      return [];
    },
    resolvePath: (basePath, importPath) => {
      // Resolve relative path to absolute file path
      return path.resolve(basePath, importPath + '.py');
    }
  },

  // 4. Error Diagnostics
  diagnostics: {
    classifyError: (output) => {
      if (output.includes('SyntaxError')) return 'compilation';
      if (output.includes('AssertionError')) return 'test';
      return undefined;
    }
  }
};
```

## Plugin Capabilities

A language plugin provides four key capabilities:

1.  **Detection**: Helps Salmon-Loop identify the project type and suggest default verification commands (e.g., `npm test` or `pytest`).
2.  **Parsing**: Provides Tree-sitter queries to understand code structure (definitions and references). This is crucial for the "Context Shrinking" feature to work effectively.
3.  **Dependency**: Enables the system to trace imports and fetch related context automatically.
4.  **Diagnostics**: Classifies command output (stdout/stderr) into standard error types (Compilation, Lint, Test, etc.), helping the AI understand *why* a verification failed.

## Best Practices

*   **Performance**: Keep your detection logic fast. Avoid scanning the entire `node_modules` or `.venv`.
*   **WASM**: If you use Tree-sitter, ensure the `.wasm` file is compatible with the version of `web-tree-sitter` used by Salmon-Loop.
*   **Error Handling**: Your plugin runs in the main process. While we wrap calls in try-catch blocks, a crashing plugin can still degrade the experience.
