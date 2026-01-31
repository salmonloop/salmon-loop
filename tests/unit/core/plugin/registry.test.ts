import { describe, it, expect, vi } from 'vitest';

import { LanguagePlugin } from '../../../../src/core/plugin/interface.js';
import { pluginRegistry } from '../../../../src/core/plugin/registry.js';

describe('PluginRegistry', () => {
  // Clear registry before each test to ensure isolation
  // Note: pluginRegistry is a singleton, so we need to be careful.
  // Ideally, we'd refactor Registry to be a class we can instantiate, but for now we reset private map if possible
  // or just use unique IDs for tests. Since we can't easily access private properties, we'll use unique IDs.

  const createMockPlugin = (id: string, ext: string[]): LanguagePlugin => ({
    meta: { id, name: `Mock ${id}`, extensions: ext },
    detection: { matches: async () => false, getVerifyCommand: async () => undefined },
    parsing: { getTreeSitterWasm: async () => '', queries: { definitions: '', references: '' } },
    dependency: { extractImports: () => [] },
    diagnostics: { classifyError: () => undefined },
  });

  it('should register and retrieve a plugin by ID', () => {
    const plugin = createMockPlugin('test-id-1', ['.t1']);
    pluginRegistry.register(plugin);

    expect(pluginRegistry.getById('test-id-1')).toBe(plugin);
  });

  it('should retrieve a plugin by extension', () => {
    const plugin = createMockPlugin('test-id-2', ['.t2', 't2x']); // Mix dot and no-dot
    pluginRegistry.register(plugin);

    expect(pluginRegistry.getByExtension('file.t2')).toBe(plugin);
    expect(pluginRegistry.getByExtension('src/file.t2x')).toBe(plugin);
  });

  it('should handle overwriting plugins with the same ID', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const plugin1 = createMockPlugin('conflict-id', ['.c1']);
    const plugin2 = createMockPlugin('conflict-id', ['.c2']); // Same ID, different ext

    pluginRegistry.register(plugin1);
    pluginRegistry.register(plugin2);

    expect(pluginRegistry.getById('conflict-id')).toBe(plugin2);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('already registered'));

    spy.mockRestore();
  });

  it('should return undefined for unknown IDs or extensions', () => {
    expect(pluginRegistry.getById('unknown-id')).toBeUndefined();
    expect(pluginRegistry.getByExtension('file.unknown')).toBeUndefined();
  });
});
