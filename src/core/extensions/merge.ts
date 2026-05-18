import type { ExtensionScope, ResolvedExtensions } from './types.js';

export interface ScopedEntry<T> {
  key: string;
  entry: T;
  scope: ExtensionScope;
}

export function mergeScopedEntries<T>(
  user: Record<string, T> | undefined,
  repo: Record<string, T> | undefined,
): ScopedEntry<T>[] {
  const merged: Map<string, ScopedEntry<T>> = new Map();

  if (user) {
    for (const [key, entry] of Object.entries(user)) {
      merged.set(key, { key, entry, scope: 'user' });
    }
  }

  if (repo) {
    for (const [key, entry] of Object.entries(repo)) {
      const previous = merged.get(key);
      if (previous) {
        merged.set(key, {
          key,
          entry: { ...(previous.entry as any), ...(entry as any) },
          scope: 'repo',
        });
      } else {
        merged.set(key, {
          key,
          entry,
          scope: 'repo',
        });
      }
    }
  }

  return Array.from(merged.values());
}

export function mergeResolvedExtensions(
  base: ResolvedExtensions,
  overlay: ResolvedExtensions | undefined,
): ResolvedExtensions {
  if (!overlay) return base;

  return {
    mcpServers: [...base.mcpServers, ...overlay.mcpServers],
    toolPlugins: [...base.toolPlugins, ...overlay.toolPlugins],
    skillDiscovery: {
      scope:
        overlay.skillDiscovery.paths.length > 0
          ? overlay.skillDiscovery.scope
          : base.skillDiscovery.scope,
      paths: [...base.skillDiscovery.paths, ...overlay.skillDiscovery.paths],
    },
  };
}
