import { logger } from '../observability/logger.js';

import { LanguagePlugin } from './interface.js';

class PluginRegistry {
  private plugins: Map<string, LanguagePlugin> = new Map();
  private extensionMap: Map<string, LanguagePlugin> = new Map();
  private changeListeners: Array<() => void> = [];

  /**
   * Register a new language plugin
   */
  register(plugin: LanguagePlugin) {
    if (this.plugins.has(plugin.meta.id)) {
      logger.warn(`Plugin ${plugin.meta.id} is already registered. Overwriting.`);
    }

    this.plugins.set(plugin.meta.id, plugin);

    // Map extensions to this plugin for quick lookup
    for (const ext of plugin.meta.extensions) {
      // normalize extension to start with dot
      const normalizedExt = ext.startsWith('.') ? ext : `.${ext}`;
      this.extensionMap.set(normalizedExt, plugin);
    }
    this.emitChange();
  }

  /**
   * Get all registered plugins
   */
  getAll(): LanguagePlugin[] {
    return Array.from(this.plugins.values());
  }

  onChange(listener: () => void): () => void {
    this.changeListeners.push(listener);
    return () => {
      this.changeListeners = this.changeListeners.filter((l) => l !== listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) {
      listener();
    }
  }

  /**
   * Get plugin by ID
   */
  getById(id: string): LanguagePlugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Get plugin by file extension
   */
  getByExtension(filepath: string): LanguagePlugin | undefined {
    // Extract extension from filepath (e.g., 'src/main.ts' -> '.ts')
    // Simple extraction, can be improved
    const match = filepath.match(/(\.[^.]+)$/);
    if (!match) return undefined;

    const ext = match[1];
    return this.extensionMap.get(ext);
  }

  /**
   * Detect language for a repository
   */
  async detectLanguage(repoPath: string): Promise<LanguagePlugin | undefined> {
    // Sort plugins? Maybe by some priority if added later.
    // For now, return the first match.
    for (const plugin of this.plugins.values()) {
      if (await plugin.detection.matches(repoPath)) {
        return plugin;
      }
    }
    return undefined;
  }
}

export const pluginRegistry = new PluginRegistry();
