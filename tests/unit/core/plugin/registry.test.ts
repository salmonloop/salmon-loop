import { getLogger } from '../../../../src/core/observability/logger.js';
import { LanguagePlugin } from '../../../../src/core/plugin/interface.js';
import { createPluginRegistry } from '../../../../src/core/plugin/registry.js';

describe('PluginRegistry', () => {
  const createMockPlugin = (id: string, ext: string[]): LanguagePlugin => ({
    meta: { id, name: `Mock ${id}`, extensions: ext },
    detection: { matches: async () => false, getVerifyCommand: async () => undefined },
    parsing: { getTreeSitterWasm: async () => '', queries: { definitions: '', references: '' } },
    dependency: { extractImports: () => [] },
    diagnostics: { classifyError: () => undefined },
  });

  it('should register and retrieve a plugin by ID', () => {
    const registry = createPluginRegistry();
    const plugin = createMockPlugin('test-id-1', ['.t1']);
    registry.register(plugin);

    expect(registry.getById('test-id-1')).toBe(plugin);
  });

  it('should retrieve a plugin by extension', () => {
    const registry = createPluginRegistry();
    const plugin = createMockPlugin('test-id-2', ['.t2', 't2x']); // Mix dot and no-dot
    registry.register(plugin);

    expect(registry.getByExtension('file.t2')).toBe(plugin);
    expect(registry.getByExtension('src/file.t2x')).toBe(plugin);
  });

  it('should handle overwriting plugins with the same ID', () => {
    const logger = getLogger();
    const spy = spyOn(logger, 'warn').mockImplementation(() => {});
    const registry = createPluginRegistry();

    const plugin1 = createMockPlugin('conflict-id', ['.c1']);
    const plugin2 = createMockPlugin('conflict-id', ['.c2']); // Same ID, different ext

    registry.register(plugin1);
    registry.register(plugin2);

    expect(registry.getById('conflict-id')).toBe(plugin2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('already registered'));

    spy.mockRestore();
  });

  it('should return undefined for unknown IDs or extensions', () => {
    const registry = createPluginRegistry();
    expect(registry.getById('unknown-id')).toBeUndefined();
    expect(registry.getByExtension('file.unknown')).toBeUndefined();
  });
});
