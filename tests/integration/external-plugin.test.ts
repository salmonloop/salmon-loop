import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { PluginLoader } from '../../src/core/plugin/loader.js';
import { pluginRegistry } from '../../src/core/plugin/registry.js';
import { ErrorType } from '../../src/core/types/index.js';

describe('External User Plugin Integration', () => {
  let fixturePath = '';

  const dummyPluginSource = `export default {
  meta: {
    id: 'dummy-lang',
    name: 'Dummy Language',
    extensions: ['.dummy']
  },
  detection: {
    matches: (path) => path.endsWith('.dummy')
  },
  parsing: {
    getTreeSitterWasm: async () => null
  },
  dependency: {
    extractImports: (content) => {
      const imports = [];
      const lines = content.split('\\n');
      for (const line of lines) {
        if (line.startsWith('import ')) {
          imports.push(line.substring(7).trim());
        }
      }
      return imports;
    }
  },
  diagnostics: {
    classifyError: (output) => {
      if (output.includes('dummy error')) {
        return 'compilation';
      }
      return 'other';
    }
  }
};`;

  beforeEach(async () => {
    // Reset plugin loader state
    PluginLoader.reset();
    mock.clearAllMocks();

    const root = await mkdtemp(join(tmpdir(), 'salmonloop-user-plugin-'));
    const pluginDir = join(root, '.salmonloop', 'languages', 'dummy');
    await mkdir(pluginDir, { recursive: true });
    await writeFile(join(pluginDir, 'index.js'), dummyPluginSource, 'utf8');
    fixturePath = root;
  });

  afterEach(async () => {
    mock.restore();
    if (fixturePath) {
      await rm(fixturePath, { recursive: true, force: true });
      fixturePath = '';
    }
  });

  it('should load user plugin from .salmonloop/languages directory', async () => {
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
