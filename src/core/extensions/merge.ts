import { ExtensionScope } from './types.js';

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
