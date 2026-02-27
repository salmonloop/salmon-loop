/**
 * Token cache with two-level caching strategy.
 *
 * Level 1: Memory LRU cache (content hash → token count)
 * Level 2: File-level cache (file path + mtime → token count)
 */

import { createHash } from 'crypto';

import { FileAdapter } from '../../adapters/fs/file-adapter.js';

import type { CacheStats, FileCacheEntry } from './types.js';

interface MemoryCacheEntry {
  contentHash: string;
  tokens: number;
}

/**
 * Two-level token cache for performance optimization.
 *
 * Features:
 * - LRU eviction policy
 * - File modification time validation
 * - Statistics for monitoring
 */
export class TokenCache {
  private memoryCache: Map<string, MemoryCacheEntry>;
  private fileCache: Map<string, FileCacheEntry>;
  private readonly maxSize: number;
  private readonly fileAdapter = new FileAdapter();
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number = 1000) {
    this.memoryCache = new Map();
    this.fileCache = new Map();
    this.maxSize = maxSize;
  }

  // ==================== Memory Cache ====================

  /**
   * Get from memory cache by content.
   */
  getFromMemory(content: string): number | null {
    const hash = this.hashContent(content);
    const entry = this.memoryCache.get(hash);

    if (entry) {
      this.hits++;
      // Move to end for LRU
      this.memoryCache.delete(hash);
      this.memoryCache.set(hash, entry);
      return entry.tokens;
    }

    this.misses++;
    return null;
  }

  /**
   * Set to memory cache.
   */
  setToMemory(content: string, tokens: number): void {
    const hash = this.hashContent(content);

    // LRU eviction: remove oldest entry
    if (this.memoryCache.size >= this.maxSize) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) {
        this.memoryCache.delete(firstKey);
      }
    }

    this.memoryCache.set(hash, { contentHash: hash, tokens });
  }

  // ==================== File Cache ====================

  /**
   * Get from file cache (validates mtime).
   */
  async getFromFile(filePath: string): Promise<FileCacheEntry | null> {
    try {
      const entry = this.fileCache.get(filePath);
      if (!entry) {
        this.misses++;
        return null;
      }

      // Validate modification time
      const stats = await this.fileAdapter.stat(filePath);
      if (stats.mtimeMs !== entry.mtime) {
        // File changed, invalidate
        this.fileCache.delete(filePath);
        this.misses++;
        return null;
      }

      this.hits++;
      // Move to end for LRU
      this.fileCache.delete(filePath);
      this.fileCache.set(filePath, entry);
      return entry;
    } catch {
      // File doesn't exist or can't be accessed
      this.fileCache.delete(filePath);
      this.misses++;
      return null;
    }
  }

  /**
   * Set file cache entry.
   */
  async setForFile(filePath: string, content: string, tokens: number): Promise<void> {
    try {
      const stats = await this.fileAdapter.stat(filePath);

      // LRU eviction
      if (this.fileCache.size >= this.maxSize) {
        const firstKey = this.fileCache.keys().next().value;
        if (firstKey) {
          this.fileCache.delete(firstKey);
        }
      }

      this.fileCache.set(filePath, {
        tokens,
        mtime: stats.mtimeMs,
        contentHash: this.hashContent(content),
      });
    } catch {
      // Ignore if file can't be accessed
    }
  }

  // ==================== Invalidation ====================

  /**
   * Invalidate specific file.
   */
  invalidateFile(filePath: string): void {
    this.fileCache.delete(filePath);
  }

  /**
   * Invalidate by content hash prefix.
   */
  invalidateByHash(hashPrefix: string): void {
    for (const [key, entry] of this.memoryCache) {
      if (entry.contentHash.startsWith(hashPrefix)) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Clear all caches.
   */
  clear(): void {
    this.memoryCache.clear();
    this.fileCache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  // ==================== Statistics ====================

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.memoryCache.size + this.fileCache.size,
      maxSize: this.maxSize * 2,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  // ==================== Private ====================

  /**
   * Hash content for cache key.
   */
  private hashContent(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16);
  }
}
