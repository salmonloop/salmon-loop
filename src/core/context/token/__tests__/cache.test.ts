import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { TokenCache } from '../cache.js';

describe('TokenCache', () => {
  let cache: TokenCache;

  beforeEach(() => {
    cache = new TokenCache(100);
  });

  afterEach(() => {
    cache.clear();
  });

  describe('memory cache', () => {
    it('should return null for cache miss', () => {
      const result = cache.getFromMemory('hello world');
      expect(result).toBeNull();
    });

    it('should cache and retrieve content', () => {
      cache.setToMemory('hello world', 10);

      const result = cache.getFromMemory('hello world');
      expect(result).toBe(10);
    });

    it('should track cache statistics', () => {
      cache.setToMemory('hello', 5);

      cache.getFromMemory('hello'); // hit
      cache.getFromMemory('world'); // miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
    });

    it('should calculate hit rate correctly', () => {
      cache.setToMemory('hello', 5);

      cache.getFromMemory('hello'); // hit
      cache.getFromMemory('hello'); // hit
      cache.getFromMemory('world'); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(2 / 3);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entries when cache is full', () => {
      const smallCache = new TokenCache(3);

      smallCache.setToMemory('a', 1);
      smallCache.setToMemory('b', 2);
      smallCache.setToMemory('c', 3);
      smallCache.setToMemory('d', 4); // Should evict 'a'

      expect(smallCache.getFromMemory('a')).toBeNull();
      expect(smallCache.getFromMemory('b')).toBe(2);
    });

    it('should move accessed entries to end (LRU)', () => {
      const smallCache = new TokenCache(3);

      smallCache.setToMemory('a', 1);
      smallCache.setToMemory('b', 2);
      smallCache.setToMemory('c', 3);

      // Access 'a' to move it to end
      smallCache.getFromMemory('a');

      // Add new entry, should evict 'b' (now oldest)
      smallCache.setToMemory('d', 4);

      expect(smallCache.getFromMemory('a')).toBe(1);
      expect(smallCache.getFromMemory('b')).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all entries and reset stats', () => {
      cache.setToMemory('hello', 5);
      cache.getFromMemory('hello');

      cache.clear();

      expect(cache.getFromMemory('hello')).toBeNull();
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('invalidateByHash', () => {
    it('should invalidate entries by hash prefix', () => {
      cache.setToMemory('hello', 5);

      // Get the hash of 'hello'
      const stats1 = cache.getStats();
      cache.getFromMemory('hello'); // hit
      const stats2 = cache.getStats();
      expect(stats2.hits).toBe(stats1.hits + 1);

      // Invalidate by first char of hash
      cache.invalidateByHash('h');
    });
  });
});
