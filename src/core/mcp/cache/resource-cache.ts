export interface ResourceCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class ResourceCache<T = unknown> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private entries = new Map<string, CacheEntry<T>>();

  constructor(options: ResourceCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.maxEntries = options.maxEntries ?? 256;
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.ttlMs): void {
    if (this.entries.size >= this.maxEntries) {
      const firstKey = this.entries.keys().next().value;
      if (firstKey) this.entries.delete(firstKey);
    }
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  deleteMatching(predicate: (key: string) => boolean): void {
    for (const key of this.entries.keys()) {
      if (predicate(key)) this.entries.delete(key);
    }
  }
}

export class McpResourceCache<T = unknown> extends ResourceCache<T> {}
