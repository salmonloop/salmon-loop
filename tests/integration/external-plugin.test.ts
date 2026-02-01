import { join } from 'path';

import { PluginLoader } from '../../src/core/plugin/loader.js';
import { pluginRegistry } from '../../src/core/plugin/registry.js';
import { ErrorType } from '../../src/core/types.js';

describe('External User Plugin Integration', () => {
  const fixturePath = join(process.cwd(), 'tests', 'integration', 'fixtures', 'user-plugin');

  beforeEach(() => {
    // Reset plugin loader state
    PluginLoader.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load user plugin from .salmonloop/languages directory', async () => {
    // Mock the .salmonloop structure by pointing to our fixture
    // The loader expects <repoPath>/.salmonloop/languages
    // Our fixture structure: tests/integration/fixtures/user-plugin/.salmonloop/languages/dummy/index.js

    // We need to create the .salmonloop structure in the fixture first
    // Actually, let's just mock the join path in the test environment or ensure the directory exists
    // The fixture path we set up: tests/integration/fixtures/user-plugin/languages/dummy/index.js
    // The loader looks for: join(repoPath, '.salmonloop', 'languages')

    // So we need to call loadPlugins with a path where path/.salmonloop/languages exists
    // Let's rely on the file system being correct.

    // Since we can't easily move the fixture to .salmonloop in CI, let's mock the path resolution
    // inside the test by using a temporary directory or just structuring the fixture correctly.
    // Let's rename the fixture directory to match structure.

    // For now, let's assume we pass the parent of .salmonloop
    // fixturePath should point to a dir that CONTAINS .salmonloop

    // Create the structure in the test environment if needed, but for now let's just
    // update the fixture creation command to include .salmonloop

    await PluginLoader.loadPlugins(fixturePath);

    const plugin = pluginRegistry.getById('dummy-lang');
    expect(plugin).toBeDefined();
    expect(plugin?.meta.name).toBe('Dummy Language');
  });

  it('should use user plugin for dependency extraction', async () => {
    await PluginLoader.loadPlugins(fixturePath);

    const plugin = pluginRegistry.getByExtension('test.dummy');
    expect(plugin).toBeDefined();

    const content = 'import foo.dummy\nimport bar.dummy';
    const imports = plugin?.dependency.extractImports(content);

    expect(imports).toEqual(['foo.dummy', 'bar.dummy']);
  });

  it('should use user plugin for error classification', async () => {
    await PluginLoader.loadPlugins(fixturePath);

    const plugin = pluginRegistry.getById('dummy-lang');
    const errorType = plugin?.diagnostics.classifyError('Some output with dummy error in it');

    expect(errorType).toBe(ErrorType.COMPILATION);
  });
});
