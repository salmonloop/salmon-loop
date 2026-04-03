/**
 * Tests for Prompt Caching Manager.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
  PromptCachingManager,
  getPromptCachingManager,
  resetPromptCachingManager,
} from '../prompt-caching.js';
import { DEFAULT_PROMPT_CACHING_CONFIG } from '../types.js';

describe('PromptCachingManager', () => {
  let manager: PromptCachingManager;

  beforeEach(() => {
    manager = new PromptCachingManager();
    resetPromptCachingManager();
  });

  afterEach(() => {
    resetPromptCachingManager();
  });

  describe('Claude caching', () => {
    it('should mark content as cacheable for Claude', () => {
      const content = 'System prompt content';
      const block = manager.markCacheableForClaude(content);

      expect(block.type).toBe('text');
      expect(block.text).toBe(content);
      expect(block.cache_control).toBeDefined();
      expect(block.cache_control?.type).toBe('ephemeral');
    });

    it('should include TTL when specified', () => {
      const content = 'System prompt';
      const block = manager.markCacheableForClaude(content, 7200);

      expect(block.cache_control?.ttl).toBe(7200);
    });

    it('should prepare Claude messages with caching', () => {
      const systemPrompt = 'You are a helpful assistant. '.repeat(200);
      const context = 'File content here... '.repeat(200);

      const result = manager.prepareClaudeMessages(systemPrompt, context);

      expect(result.system).toHaveLength(1);
      expect(result.messages).toHaveLength(1);
      expect(result.system[0].cache_control).toBeDefined();
      expect(result.messages[0].cache_control).toBeDefined();
    });

    it('does not add Claude cache_control below the cache threshold', () => {
      const systemPrompt = 'Short system prompt';
      const context = 'Short context';

      const result = manager.prepareClaudeMessages(systemPrompt, context);

      expect(result.system).toHaveLength(1);
      expect(result.messages).toHaveLength(1);
      expect(result.system[0]).toEqual({
        type: 'text',
        text: systemPrompt,
      });
      expect(result.messages[0]).toEqual({
        type: 'text',
        text: context,
      });
    });
  });

  describe('OpenAI caching', () => {
    it('should generate cache hint for OpenAI', () => {
      const hint = manager.generateOpenAICacheHint('my-namespace', ['file1', 'file2']);

      expect(hint).toContain('cache:');
      expect(hint).toContain('my-namespace');
    });

    it('should prepare OpenAI request', () => {
      const userParam = manager.prepareOpenAIRequest('test-ns', 'abc123');

      expect(userParam).toContain('test-ns');
      expect(userParam).toContain('abc123');
    });
  });

  describe('Gemini caching', () => {
    it('should generate Gemini cache config', () => {
      const config = manager.generateGeminiCacheConfig('my-cache', 3600);

      expect(config.cachedContent).toBe('my-cache');
      expect(config.ttlSeconds).toBe(3600);
    });

    it('should prepare Gemini request', () => {
      const config = manager.prepareGeminiRequest('cache-id');

      expect(config.cachedContent).toBe('cache-id');
      expect(config.ttlSeconds).toBe(DEFAULT_PROMPT_CACHING_CONFIG.defaultTTL);
    });
  });

  describe('Caching decisions', () => {
    it('should cache when tokens exceed minimum', () => {
      expect(manager.shouldCache(2000)).toBe(true);
    });

    it('should not cache when tokens below minimum', () => {
      expect(manager.shouldCache(500)).toBe(false);
    });

    it('should respect enabled config', () => {
      const disabledManager = new PromptCachingManager({
        ...DEFAULT_PROMPT_CACHING_CONFIG,
        enabled: false,
      });

      expect(disabledManager.shouldCache(5000)).toBe(false);
    });
  });

  describe('Statistics', () => {
    it('should record cache hits', () => {
      manager.recordHit(1000);

      const stats = manager.getStats();
      expect(stats.cachedTokens).toBe(1000);
    });

    it('should record cache misses', () => {
      manager.recordMiss();

      const stats = manager.getStats();
      expect(stats.cacheHitRate).toBe(0);
    });

    it('should calculate hit rate', () => {
      manager.recordHit(1000);
      manager.recordHit(500);
      manager.recordMiss();

      const stats = manager.getStats();
      expect(stats.cacheHitRate).toBeCloseTo(0.667, 2);
    });

    it('should reset statistics', () => {
      manager.recordHit(1000);
      manager.resetStats();

      const stats = manager.getStats();
      expect(stats.cachedTokens).toBe(0);
    });
  });

  describe('Provider management', () => {
    it('should set provider', () => {
      manager.setProvider('openai');
      expect(manager.getProvider()).toBe('openai');
    });
  });
});

describe('Global instance', () => {
  it('should return singleton', () => {
    const instance1 = getPromptCachingManager();
    const instance2 = getPromptCachingManager();

    expect(instance1).toBe(instance2);
  });

  it('should reset singleton', () => {
    const instance1 = getPromptCachingManager();
    resetPromptCachingManager();
    const instance2 = getPromptCachingManager();

    expect(instance1).not.toBe(instance2);
  });
});
