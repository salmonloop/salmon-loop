import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import prettier from 'eslint-plugin-prettier/recommended';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '.worktrees/**',
      'test-report.json',
      'tests/integration/fixtures/**',
      // Ignore accidental Windows-path folders copied into the repo root (e.g. "C:\\Users\\...").
      'C:*/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['**/adapters/git/git-runner.js'],
        },
      ],
    },
  },
  {
    files: ['src/core/adapters/git/git-adapter.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: ['eslint.config.js', 'vitest.config.ts'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
  },
  {
    files: ['tests/integration/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name='mock'] Literal[value=/fs/]",
          message:
            '❌ SECURITY GUARD: Do not mock "fs" or "fs/promises" in integration tests. Use RealFsTestHelper instead.',
        },
        {
          selector:
            "CallExpression[callee.object.name='vi'][callee.property.name='mock'] Literal[value='child_process']",
          message:
            '❌ SECURITY GUARD: Do not mock "child_process" in integration tests. Integration tests must use real processes.',
        },
      ],
    },
  },
);
