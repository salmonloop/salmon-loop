import { join } from 'path';

import { typescriptPlugin, tsxPlugin, javascriptPlugin } from '../../languages/typescript/index.js';
import { readdir } from '../adapters/fs/node-fs.js';
import { getLogger } from '../observability/logger.js';

import { LanguagePlugin } from './interface.js';
import type { PluginRegistry } from './registry.js';
import { validateQueryPack } from './validator.js';

// Import built-in plugins (Phase 1: explicit import)

export class PluginLoader {
  private static loaded = new WeakSet<PluginRegistry>();

  /**
   * Initialize and load all available plugins.
   * This should be called early in the application startup (e.g., Preflight).
   *
   * @param repoPath - Optional repository path to scan for user plugins
   */
  static async loadPlugins(registry: PluginRegistry, repoPath?: string) {
    if (this.loaded.has(registry)) return;

    try {
      // Phase 1: Manually register TypeScript/JavaScript plugins
      getLogger().debug('Loading built-in plugins...');

      this.registerWithValidation(registry, typescriptPlugin);
      this.registerWithValidation(registry, tsxPlugin);
      this.registerWithValidation(registry, javascriptPlugin);

      getLogger().debug(
        `Plugins loaded: ${typescriptPlugin.meta.name}, ${tsxPlugin.meta.name}, ${javascriptPlugin.meta.name}`,
      );

      // Phase 2: Load user plugins from .salmonloop/languages/
      if (repoPath) {
        await this.loadUserPlugins(registry, repoPath);
      }

      this.loaded.add(registry);
    } catch (error) {
      // In test environment, we want to know why it failed
      if (process.env.NODE_ENV === 'test') {
        const errorMsg = error instanceof Error ? error.message : String(error);
        getLogger().error(`CRITICAL: Failed to load plugins: ${errorMsg}`);
        throw error;
      }
      getLogger().error(
        `Failed to load plugins: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Scan and load user plugins from .salmonloop/languages/
   */
  private static async loadUserPlugins(registry: PluginRegistry, repoPath: string) {
    const userPluginDir = join(repoPath, '.salmonloop', 'languages');
    try {
      // Check if directory exists
      const entries = await readdir(userPluginDir, { withFileTypes: true });
      const pluginDirs = entries
        .filter((ent): ent is import('fs').Dirent & { isDirectory: () => boolean } =>
          ent.isDirectory(),
        )
        .map((ent) => ent.name);

      if (pluginDirs.length === 0) return;

      getLogger().info(`Found ${pluginDirs.length} potential user plugins in ${userPluginDir}`);

      for (const dirName of pluginDirs) {
        const entryPoint = join(userPluginDir, dirName, 'index.js');
        try {
          // Dynamic import (ESM)
          // We use file:// protocol for Windows compatibility with absolute paths in import()
          const modulePath = process.platform === 'win32' ? `file://${entryPoint}` : entryPoint;
          const pluginModule = await import(modulePath);
          const plugin = pluginModule.default as LanguagePlugin;

          if (this.isValidPlugin(plugin)) {
            this.registerWithValidation(registry, plugin);
            getLogger().info(`Loaded user plugin: ${plugin.meta.name} (${plugin.meta.id})`);
          } else {
            getLogger().warn(
              `Skipping invalid user plugin in ${dirName}: missing required fields.`,
            );
          }
        } catch (err: unknown) {
          if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
            getLogger().warn(
              `Failed to load user plugin from ${dirName}: ${err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err)}`,
            );
          }
        }
      }
    } catch (err: unknown) {
      // Ignore if directory doesn't exist
      if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
        getLogger().debug(
          `Error scanning for user plugins: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Reset loader state (useful for testing)
   */
  static reset() {
    this.loaded = new WeakSet<PluginRegistry>();
  }

  /**
   * Runtime validation of the plugin interface (Duck Typing)
   */
  private static isValidPlugin(obj: any): obj is LanguagePlugin {
    if (!obj || typeof obj !== 'object') return false;

    // Check Metadata
    if (!obj.meta || typeof obj.meta.id !== 'string' || !Array.isArray(obj.meta.extensions)) {
      return false;
    }

    // Check Detection
    if (!obj.detection || typeof obj.detection.matches !== 'function') {
      return false;
    }

    // Check Parsing
    if (!obj.parsing || typeof obj.parsing.getTreeSitterWasm !== 'function') {
      return false;
    }

    // Check Dependency
    if (!obj.dependency || typeof obj.dependency.extractImports !== 'function') {
      return false;
    }

    // Check Diagnostics
    if (!obj.diagnostics || typeof obj.diagnostics.classifyError !== 'function') {
      return false;
    }

    return true;
  }

  /**
   * Register plugin with queryPack validation
   */
  private static registerWithValidation(registry: PluginRegistry, plugin: LanguagePlugin) {
    const validation = validateQueryPack(plugin);
    if (!validation.valid) {
      getLogger().warn(
        `Plugin ${plugin.meta.id} has queryPack validation errors: ${validation.errors.join(', ')}`,
      );
    }
    registry.register(plugin);
  }
}
