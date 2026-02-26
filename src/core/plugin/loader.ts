import { join } from 'path';

import { typescriptPlugin, tsxPlugin, javascriptPlugin } from '../../languages/typescript/index.js';
import { readdir } from '../adapters/fs/node-fs.js';
import { logger } from '../observability/logger.js';

import { LanguagePlugin } from './interface.js';
import { pluginRegistry } from './registry.js';
import { validateQueryPack } from './validator.js';

// Import built-in plugins (Phase 1: explicit import)

export class PluginLoader {
  private static isLoaded = false;

  /**
   * Initialize and load all available plugins.
   * This should be called early in the application startup (e.g., Preflight).
   *
   * @param repoPath - Optional repository path to scan for user plugins
   */
  static async loadPlugins(repoPath?: string) {
    if (this.isLoaded) return;

    try {
      // Phase 1: Manually register TypeScript/JavaScript plugins
      logger.debug('Loading built-in plugins...');

      this.registerWithValidation(typescriptPlugin);
      this.registerWithValidation(tsxPlugin);
      this.registerWithValidation(javascriptPlugin);

      logger.debug(
        `Plugins loaded: ${typescriptPlugin.meta.name}, ${tsxPlugin.meta.name}, ${javascriptPlugin.meta.name}`,
      );

      // Phase 2: Load user plugins from .salmonloop/languages/
      if (repoPath) {
        await this.loadUserPlugins(repoPath);
      }

      this.isLoaded = true;
    } catch (error) {
      // In test environment, we want to know why it failed
      if (process.env.NODE_ENV === 'test') {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`CRITICAL: Failed to load plugins: ${errorMsg}`);
        throw error;
      }
      logger.error(
        `Failed to load plugins: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Scan and load user plugins from .salmonloop/languages/
   */
  private static async loadUserPlugins(repoPath: string) {
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

      logger.info(`Found ${pluginDirs.length} potential user plugins in ${userPluginDir}`);

      for (const dirName of pluginDirs) {
        const entryPoint = join(userPluginDir, dirName, 'index.js');
        try {
          // Dynamic import (ESM)
          // We use file:// protocol for Windows compatibility with absolute paths in import()
          const modulePath = process.platform === 'win32' ? `file://${entryPoint}` : entryPoint;
          const pluginModule = await import(modulePath);
          const plugin = pluginModule.default as LanguagePlugin;

          if (this.isValidPlugin(plugin)) {
            this.registerWithValidation(plugin);
            logger.info(`Loaded user plugin: ${plugin.meta.name} (${plugin.meta.id})`);
          } else {
            logger.warn(`Skipping invalid user plugin in ${dirName}: missing required fields.`);
          }
        } catch (err: unknown) {
          if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
            logger.warn(
              `Failed to load user plugin from ${dirName}: ${err instanceof Error ? (err instanceof Error ? err.message : String(err)) : String(err)}`,
            );
          }
        }
      }
    } catch (err: unknown) {
      // Ignore if directory doesn't exist
      if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
        logger.debug(
          `Error scanning for user plugins: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Reset loader state (useful for testing)
   */
  static reset() {
    this.isLoaded = false;
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
  private static registerWithValidation(plugin: LanguagePlugin) {
    const validation = validateQueryPack(plugin);
    if (!validation.valid) {
      logger.warn(
        `Plugin ${plugin.meta.id} has queryPack validation errors: ${validation.errors.join(', ')}`,
      );
    }
    pluginRegistry.register(plugin);
  }
}
