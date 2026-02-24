import { describe, expect, it } from 'bun:test';

import type { LanguagePlugin } from '../../../../src/core/plugin/interface.js';
import { validateQueryPack } from '../../../../src/core/plugin/validator.js';

describe('queryPack validation', () => {
  it('accepts valid queryPack with all required captures', () => {
    const plugin: LanguagePlugin = {
      meta: { id: 'test', name: 'Test', extensions: ['.test'] },
      detection: { matches: async () => false },
      parsing: {
        getTreeSitterWasm: async () => new Uint8Array(),
        queries: { definitions: '', references: '' },
        queryPack: {
          version: '1.0.0',
          symbols: {
            calls: '(call_expression function: (identifier) @callee)',
          },
          flow: {
            control: '(if_statement) @branch (for_statement) @loop (await_expression) @async',
            exceptions: '(try_statement) @trycatch (throw_statement) @throw (catch_clause) @catch',
          },
        },
      },
      dependency: { extractImports: () => [] },
      diagnostics: { classifyError: () => undefined },
    };

    const result = validateQueryPack(plugin);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects queryPack with missing required captures', () => {
    const plugin: LanguagePlugin = {
      meta: { id: 'test', name: 'Test', extensions: ['.test'] },
      detection: { matches: async () => false },
      parsing: {
        getTreeSitterWasm: async () => new Uint8Array(),
        queries: { definitions: '', references: '' },
        queryPack: {
          symbols: {
            calls: '(call_expression function: (identifier))', // Missing @callee
          },
        },
      },
      dependency: { extractImports: () => [] },
      diagnostics: { classifyError: () => undefined },
    };

    const result = validateQueryPack(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('symbols.calls query must include @callee capture');
  });

  it('rejects queryPack with invalid version format', () => {
    const plugin: LanguagePlugin = {
      meta: { id: 'test', name: 'Test', extensions: ['.test'] },
      detection: { matches: async () => false },
      parsing: {
        getTreeSitterWasm: async () => new Uint8Array(),
        queries: { definitions: '', references: '' },
        queryPack: {
          version: 'v1.0', // Invalid format
          symbols: {
            calls: '(call_expression function: (identifier) @callee)',
          },
        },
      },
      dependency: { extractImports: () => [] },
      diagnostics: { classifyError: () => undefined },
    };

    const result = validateQueryPack(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('semver format'))).toBe(true);
  });

  it('rejects queryPack with unbalanced parentheses', () => {
    const plugin: LanguagePlugin = {
      meta: { id: 'test', name: 'Test', extensions: ['.test'] },
      detection: { matches: async () => false },
      parsing: {
        getTreeSitterWasm: async () => new Uint8Array(),
        queries: { definitions: '', references: '' },
        queryPack: {
          symbols: {
            calls: '(call_expression function: (identifier) @callee', // Missing closing paren
          },
        },
      },
      dependency: { extractImports: () => [] },
      diagnostics: { classifyError: () => undefined },
    };

    const result = validateQueryPack(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('symbols.calls query has invalid syntax');
  });

  it('accepts plugin without queryPack', () => {
    const plugin: LanguagePlugin = {
      meta: { id: 'test', name: 'Test', extensions: ['.test'] },
      detection: { matches: async () => false },
      parsing: {
        getTreeSitterWasm: async () => new Uint8Array(),
        queries: { definitions: '', references: '' },
      },
      dependency: { extractImports: () => [] },
      diagnostics: { classifyError: () => undefined },
    };

    const result = validateQueryPack(plugin);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates flow.control required captures', () => {
    const plugin: LanguagePlugin = {
      meta: { id: 'test', name: 'Test', extensions: ['.test'] },
      detection: { matches: async () => false },
      parsing: {
        getTreeSitterWasm: async () => new Uint8Array(),
        queries: { definitions: '', references: '' },
        queryPack: {
          flow: {
            control: '(if_statement) @branch', // Missing @loop and @async
          },
        },
      },
      dependency: { extractImports: () => [] },
      diagnostics: { classifyError: () => undefined },
    };

    const result = validateQueryPack(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('flow.control query must include @loop capture');
    expect(result.errors).toContain('flow.control query must include @async capture');
  });

  it('validates flow.exceptions required captures', () => {
    const plugin: LanguagePlugin = {
      meta: { id: 'test', name: 'Test', extensions: ['.test'] },
      detection: { matches: async () => false },
      parsing: {
        getTreeSitterWasm: async () => new Uint8Array(),
        queries: { definitions: '', references: '' },
        queryPack: {
          flow: {
            exceptions: '(try_statement) @trycatch', // Missing @throw and @catch
          },
        },
      },
      dependency: { extractImports: () => [] },
      diagnostics: { classifyError: () => undefined },
    };

    const result = validateQueryPack(plugin);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('flow.exceptions query must include @throw capture');
    expect(result.errors).toContain('flow.exceptions query must include @catch capture');
  });
});
